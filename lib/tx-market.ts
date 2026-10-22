// Transaction-scoped market/account helpers — shared by lib/actions.ts and
// ops scripts (scripts/reset-economy.ts) so a one-shot DB job runs the exact
// same code path as the live server. No next/* imports: keep it scriptable.
import { db, schema } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { yesPrice, tradeCost, multiCoords, multiPrices, multiTradeCost, TRADE_FEE_CENTS } from "@/lib/lmsr";
import { accruedDebtCents, DEBT_CAP_CENTS, DEFAULT_DEBT_RATE_BPS } from "@/lib/loans";
import { liquidationValueCents, groupLiquidationValueCents, shouldLiquidate } from "@/lib/liq";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function toNum(s: string | number): number {
  return typeof s === "number" ? s : Number(s);
}

export async function credit(
  tx: Tx,
  userId: string,
  amountCents: number,
  kind: string,
  marketId: string | null,
  memo: string
) {
  const amt = Math.round(amountCents);
  // bigint columns can hold anything sane; this guards JS number precision
  // and turns nonsense deltas into a clean error instead of a DB failure.
  if (!Number.isSafeInteger(amt)) throw new Error("Amount too large");
  const [u] = await tx
    .update(schema.user)
    .set({ balanceCents: sql`${schema.user.balanceCents} + ${amt}` })
    .where(eq(schema.user.id, userId))
    .returning({ balanceCents: schema.user.balanceCents });
  if (!u) throw new Error("User not found");
  if (u.balanceCents < 0) throw new Error("Insufficient balance");
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: amt,
    balanceAfterCents: u.balanceCents,
    kind,
    marketId,
    memo,
  });
  return u.balanceCents;
}

// Zero-amount ledger row the header bell reads — for events the user didn't
// trigger themselves (settlements, liquidations, invites, admin actions).
export async function ping(tx: Pick<Tx, "select" | "insert">, userId: string, memo: string, marketId: string | null = null) {
  const [w] = await tx
    .select({ balanceCents: schema.user.balanceCents })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: 0,
    balanceAfterCents: w?.balanceCents ?? 0,
    kind: "notify",
    marketId,
    memo,
  });
}

export async function lockMarket(tx: Tx, marketId: string) {
  const rows = await tx
    .select()
    .from(schema.market)
    .where(eq(schema.market.id, marketId))
    .for("update")
    .limit(1);
  const m = rows[0];
  if (!m) throw new Error("Market not found");
  return m;
}

export async function lockUser(tx: Tx, userId: string) {
  const rows = await tx
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .for("update")
    .limit(1);
  if (!rows[0]) throw new Error("User not found");
  return rows[0];
}

// When auto-repay is on, a win's profit feeds the debt in full; off, the
// player keeps everything.
export async function garnishDebt(tx: Tx, userId: string, profitCents: number, label: string): Promise<number> {
  const u = await lockUser(tx, userId);
  const debt = accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince);
  if (!u.autoRepay) return 0;
  const skim = Math.min(Math.max(0, profitCents), debt);
  if (skim <= 0) return 0;
  const left = debt - skim;
  await tx
    .update(schema.user)
    .set({ debtCents: left, debtRateBps: left > 0 ? u.debtRateBps : 0, debtSince: left > 0 ? new Date() : null })
    .where(eq(schema.user.id, userId));
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: 0,
    balanceAfterCents: u.balanceCents,
    kind: "repay",
    marketId: null,
    memo: `${label} — win repaid ${(skim / 100).toFixed(2)}Ɱ of debt`,
  });
  return skim;
}

// Auto-repay sweep: a debtor with the flag on pays down accrued debt from
// spare balance at the top of each stake/order. Returns cents repaid — and
// mutates the caller's row (balance, debt, rate) so downstream credit checks
// see the post-sweep state, not the pre-sweep snapshot.
export async function sweepDebt(
  tx: Tx,
  u: { id: string; balanceCents: number; debtCents: number; debtRateBps: number; debtSince: Date | null }
): Promise<number> {
  const now = new Date();
  const debt = accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince, now);
  const pay = Math.min(debt, Math.max(0, u.balanceCents));
  if (pay <= 0) return 0;
  const left = debt - pay;
  await credit(tx, u.id, -pay, "repay", null, "Auto-repay — loan paid down");
  await tx
    .update(schema.user)
    .set({ debtCents: left, debtRateBps: left > 0 ? u.debtRateBps : 0, debtSince: left > 0 ? now : null })
    .where(eq(schema.user.id, u.id));
  u.balanceCents -= pay;
  u.debtCents = left;
  u.debtRateBps = left > 0 ? u.debtRateBps : 0;
  u.debtSince = left > 0 ? now : null;
  return pay;
}

// Adds `addCents` of principal at `rateBps` — existing debt is accrued first
// and the rate is blended by principal so one field covers everything.
export async function addDebt(tx: Tx, userId: string, addCents: number, rateBps: number, memo: string) {
  const u = await lockUser(tx, userId);
  const now = new Date();
  const cur = accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince, now);
  const total = Math.min(DEBT_CAP_CENTS, cur + Math.round(addCents));
  const blended = total <= 0 ? 0 : Math.round((cur * u.debtRateBps + Math.round(addCents) * rateBps) / total);
  await tx
    .update(schema.user)
    .set({ debtCents: total, debtRateBps: blended, debtSince: total > 0 ? now : null })
    .where(eq(schema.user.id, userId));
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: 0,
    balanceAfterCents: u.balanceCents,
    kind: "debt",
    marketId: null,
    memo,
  });
}

// Retires `cents` of accrued debt without cash — the settlement mirror of
// addDebt, used when a leveraged position's proceeds repay its own margin.
export async function releaseDebt(tx: Tx, userId: string, cents: number, memo: string) {
  const u = await lockUser(tx, userId);
  const now = new Date();
  const cur = accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince, now);
  const left = Math.max(0, cur - Math.round(cents));
  await tx
    .update(schema.user)
    .set({ debtCents: left, debtRateBps: left > 0 ? u.debtRateBps : 0, debtSince: left > 0 ? now : null })
    .where(eq(schema.user.id, userId));
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: 0,
    balanceAfterCents: u.balanceCents,
    kind: "debt",
    marketId: null,
    memo,
  });
}

// Sweep a binary market: any leveraged position whose liquidation value can
// no longer cover its loan is force-sold at the current book; the proceeds
// service the debt first, the remainder (if any) credits the user. Iterates
// to a fixpoint — a liquidation late in the scan can push an earlier-passed
// position under the cushion, so loop until a pass frees nothing.
export async function checkLiquidations(tx: Tx, marketId: string, debtRateBps = DEFAULT_DEBT_RATE_BPS) {
  const m = await lockMarket(tx, marketId);
  let qy = toNum(m.qYes);
  let qn = toNum(m.qNo);
  let touched = false;
  for (;;) {
    const rows = await tx
      .select()
      .from(schema.position)
      .where(and(eq(schema.position.marketId, marketId), sql`${schema.position.debtCents} > 0`))
      .for("update");
    let passTouched = false;
    for (const p of rows) {
      const y = toNum(p.yesShares);
      const n = toNum(p.noShares);
      const valueCents = liquidationValueCents(qy, qn, m.b, y, n);
      if (!shouldLiquidate(valueCents, p.debtCents, m.maxLeverage)) continue;
      qy -= y;
      qn -= n;
      const equity = valueCents - p.debtCents;
      await lockUser(tx, p.userId);
      const title = m.question.slice(0, 50);
      const nums = `sold for Ɱ${(valueCents / 100).toFixed(0)} vs loan Ɱ${(p.debtCents / 100).toFixed(0)}`;
      if (equity > 0) {
        await credit(tx, p.userId, equity, "liq", marketId, `Liquidated (${nums}): ${title}`);
        await ping(tx, p.userId, `Position liquidated in “${title}” — the market moved and your shares' sell value (${nums}) fell under the loan. Ɱ${(equity / 100).toFixed(2)} returned.`, marketId);
      } else {
        // A wipeout is silent without a row — tell them the position died.
        const [w] = await tx.select({ balanceCents: schema.user.balanceCents }).from(schema.user).where(eq(schema.user.id, p.userId)).limit(1);
        await tx.insert(schema.ledger).values({
          userId: p.userId,
          amountCents: 0,
          balanceAfterCents: w?.balanceCents ?? 0,
          kind: "liq",
          marketId,
          memo: `Liquidated (total loss, ${nums}): ${title}`,
        });
        // A violent gap can liquidate below the loan — the uncovered part of
        // the margin becomes account debt, same as a busted game round.
        if (equity < 0)
          await addDebt(tx, p.userId, -equity, debtRateBps, `Liquidation shortfall: ${title}`);
        await ping(
          tx,
          p.userId,
          `Position liquidated in “${title}” — sell value ${nums}; your collateral is gone` +
            (equity < 0 ? ` and the unpaid Ɱ${(-equity / 100).toFixed(2)} of the loan is now debt.` : "."),
          marketId
        );
      }
      await tx
        .delete(schema.position)
        .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, p.userId)));
      passTouched = true;
      touched = true;
    }
    if (!passTouched) break;
  }
  if (touched) {
    await tx.update(schema.market).set({ qYes: String(qy), qNo: String(qn) }).where(eq(schema.market.id, marketId));
    await tx.insert(schema.pricePoint).values({ marketId, yesPrice: yesPrice(qy, qn, m.b).toFixed(5) });
  }
}

// Same sweep for a group book: one option's trade moves every sibling's
// price, so the whole family's leveraged positions get checked. `book` is
// the locked live siblings with post-trade coordinates — a liquidation sells
// the position back: YES shares come off that option's coordinate, NO shares
// (the complement bundle) come off every sibling's via the shared math.
export async function checkGroupLiquidations(
  tx: Tx,
  book: { m: typeof schema.market.$inferSelect; qYes: number; qNo: number; dirty: boolean }[],
  debtRateBps = DEFAULT_DEBT_RATE_BPS
) {
  const b = book[0]?.m.b ?? 300;
  let touched = false;
  for (;;) {
    let passTouched = false;
    for (let i = 0; i < book.length; i++) {
      const { m } = book[i];
      const rows = await tx
        .select()
        .from(schema.position)
        .where(and(eq(schema.position.marketId, m.id), sql`${schema.position.debtCents} > 0`))
        .for("update");
      for (const p of rows) {
        const y = toNum(p.yesShares);
        const n = toNum(p.noShares);
        const coords = multiCoords(book);
        const valueCents = groupLiquidationValueCents(coords, b, i, y, n);
        if (!shouldLiquidate(valueCents, p.debtCents, m.maxLeverage)) continue;
        book[i].qYes -= y;
        book[i].qNo -= n;
        book[i].dirty = true;
        const equity = valueCents - p.debtCents;
        await lockUser(tx, p.userId);
        const title = m.question.slice(0, 50);
        const nums = `sold for Ɱ${(valueCents / 100).toFixed(0)} vs loan Ɱ${(p.debtCents / 100).toFixed(0)}`;
        if (equity > 0) {
          await credit(tx, p.userId, equity, "liq", m.id, `Liquidated (${nums}): ${title}`);
          await ping(tx, p.userId, `Position liquidated in “${title}” — the market moved and your shares' sell value (${nums}) fell under the loan. Ɱ${(equity / 100).toFixed(2)} returned.`, m.id);
        } else {
          // A wipeout is silent without a row — tell them the position died.
          const [w] = await tx.select({ balanceCents: schema.user.balanceCents }).from(schema.user).where(eq(schema.user.id, p.userId)).limit(1);
          await tx.insert(schema.ledger).values({
            userId: p.userId,
            amountCents: 0,
            balanceAfterCents: w?.balanceCents ?? 0,
            kind: "liq",
            marketId: m.id,
            memo: `Liquidated (total loss, ${nums}): ${title}`,
          });
          // A violent gap can liquidate below the loan — the uncovered part of
          // the margin becomes account debt, same as a busted game round.
          if (equity < 0)
            await addDebt(tx, p.userId, -equity, debtRateBps, `Liquidation shortfall: ${title}`);
          await ping(
            tx,
            p.userId,
            `Position liquidated in “${title}” — sell value ${nums}; your collateral is gone` +
              (equity < 0 ? ` and the unpaid Ɱ${(-equity / 100).toFixed(2)} of the loan is now debt.` : "."),
            m.id
          );
        }
        await tx
          .delete(schema.position)
          .where(and(eq(schema.position.marketId, m.id), eq(schema.position.userId, p.userId)));
        passTouched = true;
        touched = true;
      }
    }
    if (!passTouched) break;
  }
  if (touched) {
    // Liquidations reprice the whole book — persist every moved coordinate
    // and give each sibling a fresh point so the lines stay consistent.
    const prices = multiPrices(multiCoords(book), b);
    for (const [i, s] of book.entries()) {
      if (s.dirty) {
        await tx
          .update(schema.market)
          .set({ qYes: s.qYes.toFixed(6), qNo: s.qNo.toFixed(6) })
          .where(eq(schema.market.id, s.m.id));
      }
      await tx.insert(schema.pricePoint).values({ marketId: s.m.id, yesPrice: prices[i].toFixed(5) });
    }
  }
}

// ---------- take-profit / stop-loss fills ----------
//
// A stop is a resting sell order on one side at a trigger price. The side's
// *_sell_pct caps the fill to a fraction (null = 100%); the fired trigger is
// always consumed — a partial fill leaves the rest of the side (and the
// sibling trigger on it) untouched. Fills pay the same Ɱ1 close fee and
// service the position loan first — identical money flow to a manual close.
// Fills iterate to a fixpoint with a hard pass cap: one fill moves the book
// and can trip the next holder's stop.

const STOP_MAX_PASSES = 50;

type StopRow = typeof schema.position.$inferSelect;
type Trigger = { outcome: "yes" | "no"; shares: number; held: number; kind: "tp" | "sl"; at: number; pct: number };

// Shares a fired trigger sells: pct of the side, snapped to a full sell when
// the remainder would be dust.
function sellQty(held: number, pct: number) {
  const q = pct >= 100 ? held : (held * pct) / 100;
  return held - q < 1e-4 ? held : q;
}

// Which side tripped, if any. YES side watches yesPrice, NO side watches its
// complement. Returns the fill reason for the ledger memo.
function triggeredSide(p: StopRow, pYes: number): Trigger | null {
  const tpYes = p.tpYes == null ? null : toNum(p.tpYes);
  const slYes = p.slYes == null ? null : toNum(p.slYes);
  const tpNo = p.tpNo == null ? null : toNum(p.tpNo);
  const slNo = p.slNo == null ? null : toNum(p.slNo);
  const pNo = 1 - pYes;
  const y = toNum(p.yesShares);
  const n = toNum(p.noShares);
  const yPct = p.yesSellPct ?? 100;
  const nPct = p.noSellPct ?? 100;
  if (y > 1e-9 && tpYes != null && pYes >= tpYes) return { outcome: "yes", shares: sellQty(y, yPct), held: y, kind: "tp", at: tpYes, pct: yPct };
  if (y > 1e-9 && slYes != null && pYes <= slYes) return { outcome: "yes", shares: sellQty(y, yPct), held: y, kind: "sl", at: slYes, pct: yPct };
  if (n > 1e-9 && tpNo != null && pNo >= tpNo) return { outcome: "no", shares: sellQty(n, nPct), held: n, kind: "tp", at: tpNo, pct: nPct };
  if (n > 1e-9 && slNo != null && pNo <= slNo) return { outcome: "no", shares: sellQty(n, nPct), held: n, kind: "sl", at: slNo, pct: nPct };
  return null;
}

// Fill one triggered side: price the refund off the book, take the close fee,
// repay the position loan, credit the rest, write the
// trade + ledger rows, and decrement that side by the filled shares. The
// fired trigger clears; a surviving remainder keeps the sibling trigger.
// Drops the row when nothing is left.
async function fillStop(
  tx: Tx,
  m: typeof schema.market.$inferSelect,
  p: StopRow,
  trig: Trigger,
  proceedsCents: number,
  execPrice: number,
  orderFee = TRADE_FEE_CENTS
) {
  let rest = proceedsCents;
  const debtRepay = Math.min(rest, p.debtCents);
  rest -= debtRepay;
  const feeCharge = Math.min(orderFee, rest);
  rest -= feeCharge;
  const pctNote = trig.pct < 100 && trig.shares < trig.held - 1e-9 ? ` (${trig.pct}%)` : "";
  const label = `${trig.kind === "tp" ? "Take-profit" : "Stop-loss"} ${trig.outcome.toUpperCase()} @ ${trig.at.toFixed(2)}${pctNote}: ${m.question.slice(0, 50)}`;
  const skim = Math.min(rest, await garnishDebt(tx, p.userId, rest, label));
  rest -= skim;
  // Sell row shows proceeds net of debt repayment only — the fee gets its own
  // "fee" ledger row (net balance delta is unchanged).
  if (rest + feeCharge > 0) await credit(tx, p.userId, rest + feeCharge, "sell", m.id, label);
  else {
    // Zero-proceeds fills still need a ledger row or the exit looks silent.
    const [w] = await tx.select({ balanceCents: schema.user.balanceCents }).from(schema.user).where(eq(schema.user.id, p.userId)).limit(1);
    await tx.insert(schema.ledger).values({ userId: p.userId, amountCents: 0, balanceAfterCents: w?.balanceCents ?? 0, kind: "sell", marketId: m.id, memo: label });
  }
  if (feeCharge > 0) await credit(tx, p.userId, -feeCharge, "fee", m.id, `Close order fee — ${label}`);
  await tx.insert(schema.trade).values({
    marketId: m.id,
    userId: p.userId,
    side: "sell",
    outcome: trig.outcome,
    shares: String(trig.shares),
    amountCents: proceedsCents,
    yesPriceAfter: execPrice.toFixed(5),
  });

  const remain = Math.max(0, trig.held - trig.shares);
  const emptied = remain <= 1e-9;
  const sideSet =
    trig.outcome === "yes"
      ? {
          yesShares: String(remain),
          tpYes: emptied || trig.kind === "tp" ? null : p.tpYes,
          slYes: emptied || trig.kind === "sl" ? null : p.slYes,
        }
      : {
          noShares: String(remain),
          tpNo: emptied || trig.kind === "tp" ? null : p.tpNo,
          slNo: emptied || trig.kind === "sl" ? null : p.slNo,
        };
  const otherShares = trig.outcome === "yes" ? toNum(p.noShares) : toNum(p.yesShares);
  const debtLeft = p.debtCents - debtRepay;
  if (emptied && otherShares <= 1e-9 && debtLeft <= 0) {
    await tx
      .delete(schema.position)
      .where(and(eq(schema.position.marketId, p.marketId), eq(schema.position.userId, p.userId)));
  } else {
    await tx
      .update(schema.position)
      .set({ ...sideSet, debtCents: debtLeft })
      .where(and(eq(schema.position.marketId, p.marketId), eq(schema.position.userId, p.userId)));
  }
}

// Binary market: sweep resting stops against the live price until none trip.
export async function runStops(tx: Tx, marketId: string, orderFee = TRADE_FEE_CENTS) {
  const m = await lockMarket(tx, marketId);
  let qy = toNum(m.qYes);
  let qn = toNum(m.qNo);
  let volAdd = 0;
  let touched = false;
  for (let pass = 0; pass < STOP_MAX_PASSES; pass++) {
    const pYes = yesPrice(qy, qn, m.b);
    const rows = await tx
      .select()
      .from(schema.position)
      .where(
        and(
          eq(schema.position.marketId, marketId),
          sql`(${schema.position.tpYes} is not null or ${schema.position.slYes} is not null or ${schema.position.tpNo} is not null or ${schema.position.slNo} is not null)`
        )
      )
      .for("update");
    let passTouched = false;
    for (const p of rows) {
      const trig = triggeredSide(p, pYes);
      if (!trig) continue;
      const proceedsCents = Math.max(0, Math.round(-tradeCost(qy, qn, m.b, trig.outcome, -trig.shares) * 100));
      if (trig.outcome === "yes") qy -= trig.shares;
      else qn -= trig.shares;
      const newPy = yesPrice(qy, qn, m.b);
      await fillStop(tx, m, p, trig, proceedsCents, newPy, orderFee);
      await tx.insert(schema.pricePoint).values({ marketId, yesPrice: newPy.toFixed(5) });
      volAdd += proceedsCents;
      passTouched = true;
      touched = true;
    }
    if (!passTouched) break;
  }
  if (touched) {
    await tx
      .update(schema.market)
      .set({ qYes: String(qy), qNo: String(qn), volumeCents: sql`${schema.market.volumeCents} + ${volAdd}` })
      .where(eq(schema.market.id, marketId));
  }
}

// Group market: same sweep, but prices come from the shared book and a fill
// on one option reprices every sibling (siblings each get a fresh point).
export async function runGroupStops(
  tx: Tx,
  book: { m: typeof schema.market.$inferSelect; qYes: number; qNo: number; dirty: boolean }[],
  orderFee = TRADE_FEE_CENTS
) {
  const b = book[0]?.m.b ?? 300;
  for (let pass = 0; pass < STOP_MAX_PASSES; pass++) {
    const prices = multiPrices(multiCoords(book), b);
    let passTouched = false;
    for (let i = 0; i < book.length; i++) {
      const { m } = book[i];
      const rows = await tx
        .select()
        .from(schema.position)
        .where(
          and(
            eq(schema.position.marketId, m.id),
            sql`(${schema.position.tpYes} is not null or ${schema.position.slYes} is not null or ${schema.position.tpNo} is not null or ${schema.position.slNo} is not null)`
          )
        )
        .for("update");
      for (const p of rows) {
        const trig = triggeredSide(p, prices[i]);
        if (!trig) continue;
        const proceedsCents = Math.max(0, Math.round(-multiTradeCost(multiCoords(book), b, i, trig.outcome, -trig.shares) * 100));
        if (trig.outcome === "yes") book[i].qYes -= trig.shares;
        else book[i].qNo -= trig.shares;
        book[i].dirty = true;
        const newPrices = multiPrices(multiCoords(book), b);
        await fillStop(tx, m, p, trig, proceedsCents, newPrices[i], orderFee);
        for (const [j, s] of book.entries()) {
          await tx.insert(schema.pricePoint).values({ marketId: s.m.id, yesPrice: newPrices[j].toFixed(5) });
        }
        await tx
          .update(schema.market)
          .set({ volumeCents: sql`${schema.market.volumeCents} + ${proceedsCents}` })
          .where(eq(schema.market.id, m.id));
        passTouched = true;
      }
    }
    if (!passTouched) break;
  }
  // Stop fills moved sibling coordinates — persist every dirty option, same
  // as the liquidation sweep does.
  for (const s of book) {
    if (s.dirty) {
      await tx
        .update(schema.market)
        .set({ qYes: s.qYes.toFixed(6), qNo: s.qNo.toFixed(6) })
        .where(eq(schema.market.id, s.m.id));
    }
  }
}
