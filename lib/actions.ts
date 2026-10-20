"use server";

import { db, schema } from "@/lib/db";
import { eq, ne, and, sql, desc, asc, isNull, inArray, gte } from "drizzle-orm";
import { randomInt, createHmac, timingSafeEqual } from "node:crypto";
import { GAME_LEVERAGES, gameLevCap, gameBetCap, GAME_FEE_CENTS, MAX_GAME_WAGER_CENTS, MAX_GAME_STAKE_CENTS, GAME_WINDOW_MS, GAME_DAILY_LIMIT_MS, GAME_IDLE_MS, COINFLIP_MULT, diceMult, DICE_MIN_OVER, DICE_MAX_OVER, TIMER_TARGETS, timerMult, timerJitterRangeMs, GAME_KEYS, type GameKey, cardOrder, cardIsRed, cardLabel, REDBLACK_MULT, hiloMult, hiloWinRanks, type HiloDir, LIMBO_MIN, LIMBO_MAX, WHEEL_SEGMENTS, PLINKO_ROWS, PLINKO_ROW_CHOICES, plinkoMults, PLINKO_MULT, plinkoBucket, plinkoPathForBucket, SLOT_SYMBOLS, SLOT_TOTAL_WEIGHT, slotDraw, slotPayout, handTotal, isNatural, BJ_WIN_MULT, BJ_NATURAL_MULT, BJ_DECKS, evalPerfectPairs, evalTwentyOnePlusThree, dealerFx, blessedChancePct, TAV_BONUS_PCT, TAV_COOLDOWN_MS, WALL_COOLDOWN_MS, WALL_FEE_MIN_CENTS, WALL_FEE_DEBT_PCT, WALL_CLEAR_MIN_PCT, WALL_CLEAR_MAX_PCT, WALL_SILENT_PCT, WALL_MIRACLE_PER_MILLE, WALL_BACKFIRE_PCT, WALL_BLESSED_RE, WALL_BLESSED_SILENT_PCT, WALL_BLESSED_MIRACLE_PER_MILLE, WALL_BLESSED_CLEAR_MAX_PCT, VOW_CHOICES_BPS, DUEL_KINDS, RPS_MOVES, RPS_BEATS, DUEL_NAMES, DUEL_GAME_KEY, DUEL_TIMER_MS, type DuelKind, type DuelMove, type RpsMove, type Persona } from "@/lib/games";
import { revalidatePath, updateTag } from "next/cache";
import { requireUser, requireAdmin, isAdmin } from "@/lib/session";
import { SUPER_ADMIN_EMAIL } from "@/lib/auth";
import { yesPrice, tradeCost, sharesForSpend, qForProb, multiCoords, multiPrices, multiTradeCost, multiSharesForSpend, multiQForProb, houseSeedCents, MAX_TRADE_CENTS, MAX_TRADE_SPEND_CENTS, MIN_TRADE_CENTS, TRADE_FEE_CENTS } from "@/lib/lmsr";
import { loanFor, liquidationValueCents, groupLiquidationValueCents, shouldLiquidate, levFeeCents, levWinCents, levWinRawCents, LEV_FEE_BPS } from "@/lib/liq";
import { toNum, credit, lockUser, lockMarket, checkLiquidations, checkGroupLiquidations, garnishDebt, runStops, runGroupStops, addDebt, releaseDebt, ping, sweepDebt, type Tx } from "@/lib/tx-market";
import { resetEconomyTx } from "@/lib/economy-reset";
import { accruedDebtCents, LOAN_PRESETS_CENTS, LOAN_OFFER_COUNT, LOAN_OFFER_TTL_MS, rollRateBps, DEBT_CAP_CENTS, GAME_DEBT_RATE_BPS } from "@/lib/loans";
import { capJobPay, dishesPay, DISH_PAY_CENTS, genMathProblems, JOBS, mathAnswer, mathPay, type Job, type MathProblem } from "@/lib/jobs";
import { marketYesPrice, getMarketBetCount, getStatsSince } from "@/lib/queries";
import {
  DAILY_AMOUNT,
  DAILY_COOLDOWN_MS,
  WEEKLY_AMOUNT,
  WEEKLY_COOLDOWN_MS,
  AD_AMOUNT,
  AD_COOLDOWN_MS,
  BONUS_MAP,
  REFEREE_BONUS,
  REFERRER_BONUS,
  REFERRAL_EARN_KINDS,
  REFERRAL_ROYALTY_BPS,
  REFERRAL_ROYALTY_CAP_CENTS,
  STREAK_WINDOW_MS,
  STREAK_PER_DAY_CENTS,
  STREAK_CAP_DAYS,
} from "@/lib/rewards";

// Tx + the shared balance/market helpers (credit, lockUser, lockMarket,
// toNum, checkLiquidations, checkGroupLiquidations) live in
// lib/tx-market.ts so ops scripts can run the identical code path.

// Crude spam brakes for a friends group — recent-row counts on the live
// tables, generous thresholds, no new infra.
async function assertNotSpam(userId: string, kind: "trade" | "game" | "comment" | "loan" | "wall") {
  const limits = { trade: 60, game: 240, comment: 5, loan: 3, wall: 2 };
  const max = limits[kind];
  let n = 0;
  if (kind === "comment") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.comment)
      .where(and(eq(schema.comment.userId, userId), sql`${schema.comment.createdAt} > now() - interval '5 minutes'`));
    n = r?.n ?? 0;
  } else if (kind === "loan") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ledger)
      .where(and(eq(schema.ledger.userId, userId), eq(schema.ledger.kind, "loan"), sql`${schema.ledger.createdAt} > now() - interval '1 hour'`));
    n = r?.n ?? 0;
  } else if (kind === "game") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ledger)
      .where(and(eq(schema.ledger.userId, userId), eq(schema.ledger.kind, "game"), sql`${schema.ledger.createdAt} > now() - interval '5 minutes'`));
    n = r?.n ?? 0;
  } else if (kind === "wall") {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.wallPrayer)
      .where(and(eq(schema.wallPrayer.userId, userId), sql`${schema.wallPrayer.createdAt} > now() - interval '5 minutes'`));
    n = r?.n ?? 0;
  } else {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.trade)
      .where(and(eq(schema.trade.userId, userId), sql`${schema.trade.createdAt} > now() - interval '5 minutes'`));
    n = r?.n ?? 0;
  }
  if (n >= max) throw new Error("Too fast — wait a few minutes");
}

// ---------- helpers ----------

// Live-sibling softmax mark for an option — the shared book's price. Binary
// markets and orphan options fall back to the standalone binary price.
async function optionMarkPrice(tx: Tx, m: typeof schema.market.$inferSelect): Promise<number> {
  if (!m.parentId) return marketYesPrice(m);
  const sibs = await tx
    .select()
    .from(schema.market)
    .where(and(eq(schema.market.parentId, m.parentId), eq(schema.market.status, "live")));
  const i = sibs.findIndex((s) => s.id === m.id);
  if (i < 0) return marketYesPrice(m);
  const prices = multiPrices(
    multiCoords(sibs.map((s) => ({ qYes: toNum(s.qYes), qNo: toNum(s.qNo) }))),
    m.b
  );
  return prices[i];
}

// Short random market slug — "/market/7kx9q2mp". Unambiguous alphabet.
const SLUG_ABC = "abcdefghjkmnpqrstuvwxyz23456789";
function newSlug(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => SLUG_ABC[b % SLUG_ABC.length]).join("");
}

// Generate until free — collisions are ~1e-12 but cheap to rule out.
async function uniqueSlug(tx: Tx): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const s = newSlug();
    const [hit] = await tx
      .select({ id: schema.market.id })
      .from(schema.market)
      .where(eq(schema.market.slug, s))
      .limit(1);
    if (!hit) return s;
  }
  throw new Error("Could not allocate a slug");
}

// After an option resolves/cancels, roll the group up: no live options left
// means the group itself is done.
async function syncGroupStatus(tx: Tx, m: typeof schema.market.$inferSelect) {
  if (!m.parentId) return;
  const sibs = await tx
    .select({ status: schema.market.status })
    .from(schema.market)
    .where(eq(schema.market.parentId, m.parentId));
  if (sibs.some((s) => s.status === "live")) return;
  const parentResolved = sibs.some((s) => s.status === "resolved");
  await tx
    .update(schema.market)
    .set({
      status: parentResolved ? "resolved" : "cancelled",
      resolvedAt: new Date(),
    })
    .where(eq(schema.market.id, m.parentId));
  const [parent] = await tx.select().from(schema.market).where(eq(schema.market.id, m.parentId)).limit(1);
  if (parent) revalidatePath(`/market/${parent.slug}`);

  // Recurring group: the series rolls over only when it finished resolved —
  // a cancelled run stops the cadence. Options clone with fresh uniform
  // pricing; labels, images and leverage carry over.
  if (parent?.recurDays && parentResolved) {
    const recurMs = parent.recurDays * 24 * 3600 * 1000;
    // Same roll-forward rule as binary clones — no zombie markets.
    let periods = 1;
    let nextClose = new Date((parent.closesAt?.getTime() ?? Date.now()) + recurMs);
    while (nextClose.getTime() <= Date.now()) {
      nextClose = new Date(nextClose.getTime() + recurMs);
      periods++;
    }
    const nextOpen = parent.opensAt ? new Date(parent.opensAt.getTime() + periods * recurMs) : null;
    const [clone] = await tx
      .insert(schema.market)
      .values({
        slug: await uniqueSlug(tx),
        question: parent.question,
        description: parent.description,
        context: parent.context,
        category: parent.category,
        status: "live",
        kind: "group",
        creatorId: parent.creatorId,
        b: parent.b,
        opensAt: nextOpen,
        closesAt: nextClose,
        recurDays: parent.recurDays,
        maxLeverage: parent.maxLeverage,
        maxBetCents: parent.maxBetCents,
        imageUrl: parent.imageUrl,
      })
      .returning({ id: schema.market.id });
    const kids = sibs.length;
    const base = parent.question.replace(/[?？!.\s]+$/g, "");
    const originals = await tx
      .select()
      .from(schema.market)
      .where(eq(schema.market.parentId, parent.id))
      .orderBy(asc(schema.market.sortIndex));
    // Seed each clone from its own opening price — flat uniform odds on a
    // lopsided group is free money for the first trader of every cycle.
    // Options share one book, so the seeds normalize back to a 100% split.
    const seeds = await Promise.all(
      originals.map(async (o) => {
        const [seed] = await tx
          .select({ yesPrice: schema.pricePoint.yesPrice })
          .from(schema.pricePoint)
          .where(eq(schema.pricePoint.marketId, o.id))
          .orderBy(asc(schema.pricePoint.createdAt))
          .limit(1);
        return Math.max(0.001, toNum(seed?.yesPrice ?? String(1 / kids)));
      })
    );
    const seedSum = seeds.reduce((a, s) => a + s, 0);
    for (const [i, o] of originals.entries()) {
      const pi = Math.min(0.999, seeds[i] / seedSum);
      const [child] = await tx
        .insert(schema.market)
        .values({
          slug: await uniqueSlug(tx),
          question: `${base} — ${o.label ?? o.question}?`,
          description: parent.description,
          category: parent.category,
          status: "live",
          kind: "option",
          parentId: clone.id,
          label: o.label,
          imageUrl: o.imageUrl,
          sortIndex: i,
          creatorId: parent.creatorId,
          b: parent.b,
          qYes: multiQForProb(pi, parent.b).toFixed(6),
          qNo: "0",
          volumeCents: houseSeedCents(parent.b),
          seedCents: houseSeedCents(parent.b),
          opensAt: nextOpen,
          closesAt: nextClose,
          maxLeverage: parent.maxLeverage,
          maxBetCents: parent.maxBetCents,
        })
        .returning({ id: schema.market.id });
      await tx.insert(schema.pricePoint).values({ marketId: child.id, yesPrice: pi.toFixed(5) });
    }
  }
}

// ---------- trading ----------

// Leverage: the user posts `spend` as collateral and the house lends the rest,
// so `notional = spend × leverage` worth of shares. The loan lives on the
// position row as debtCents and is repaid out of sells/resolves/refunds.
// Caps above 20x work because the liquidation cushion scales down with the
// market's cap (see liqCushion): the buffer stays a fixed share of the
// collateral instead of exceeding it. Buys whose own price impact would
// still kill the position are rejected at trade time, not silently swept.
const TRADE_LEVERAGES = [1, 2, 3, 5, 10, 20, 50, 100];

// Leveraged-position liquidation sweeps (checkLiquidations /
// checkGroupLiquidations) live in lib/tx-market.ts — they run inside the
// trade tx after the book moved, so sequential sells keep the q's honest.
export async function placeTrade(input: {
  marketId: string;
  outcome: "yes" | "no";
  side: "buy" | "sell";
  spendCents?: number;
  shares?: number;
  leverage?: number;
}): Promise<{ ok: true; shares: number; costCents: number; price: number } | { ok: false; error: string }> {
  try {
    const u = await requireUser();
    const { marketId, outcome, side } = input;
    if (outcome !== "yes" && outcome !== "no") throw new Error("Bad outcome");
    await assertNotSpam(u.id, "trade");

    let result!: { shares: number; costCents: number; price: number };

    await db.transaction(async (tx) => {
      // Options trade on the group's shared book — a trade on one moves every
      // sibling's price, so lock the whole live family in id order. Binary
      // markets keep the single-row lock.
      const [peek] = await tx
        .select()
        .from(schema.market)
        .where(eq(schema.market.id, marketId))
        .limit(1);
      if (!peek) throw new Error("Market not found");
      let m = peek;
      let sibs: (typeof schema.market.$inferSelect)[] | null = null;
      if (peek.parentId) {
        sibs = await tx
          .select()
          .from(schema.market)
          .where(and(eq(schema.market.parentId, peek.parentId), eq(schema.market.status, "live")))
          .orderBy(asc(schema.market.id))
          .for("update");
        m = sibs.find((s) => s.id === marketId) ?? m; // absent ⇒ not live
      } else {
        m = await lockMarket(tx, marketId);
      }
      if (m.kind === "group") throw new Error("Trade one of this market's options");
      if (m.status !== "live") throw new Error("Market is not live");
      if (m.opensAt && new Date(m.opensAt) > new Date()) throw new Error("Trading is not open yet");
      if (m.closesAt && new Date(m.closesAt) <= new Date()) throw new Error("Market is closed");
      const cur = await lockUser(tx, u.id);
      // Auto-repay sweeps spare balance into the loan before the order is
      // priced — a buy then sees the post-repay balance.
      if (cur.autoRepay) await sweepDebt(tx, cur);
      const [levCfg] = await tx
        .select({ tMax: schema.casinoConfig.tradeMaxLev, feeBps: schema.casinoConfig.levFeeBps, maxSpend: schema.casinoConfig.tradeMaxSpendCents, flatFee: schema.casinoConfig.tradeFeeCents, minTrade: schema.casinoConfig.minTradeCents, debtRate: schema.casinoConfig.debtRateBps })
        .from(schema.casinoConfig)
        .where(eq(schema.casinoConfig.id, "house"));
      const orderFee = levCfg?.flatFee ?? TRADE_FEE_CENTS;

      const qYes = toNum(m.qYes);
      const qNo = toNum(m.qNo);
      const b = m.b;
      // Mutable copy of the locked siblings — trades and liquidation sweeps
      // move these coordinates; dirty rows persist at the end.
      const book = sibs?.map((s) => ({ m: s, qYes: toNum(s.qYes), qNo: toNum(s.qNo), dirty: false }));
      const k = sibs ? sibs.findIndex((s) => s.id === m.id) : -1;
      const coords = book ? multiCoords(book) : null;

      let shares: number;
      let cashDelta: number; // negative = pay, positive = receive
      let debtDelta = 0; // new loan principal on leveraged buys
      let debtRepay = 0; // loan repaid out of sell proceeds
      let grossSellCents = 0; // sell proceeds before the loan takes its cut
      let vowSkimCents = 0; // wall-vow share of proceeds routed to debt
      let notionalCents = 0; // buy: full position size incl. borrowed funds
      let feeCharge = 0; // flat order fee — lands as its own "fee" ledger row

      if (side === "buy") {
        const spend = Math.round(input.spendCents ?? 0);
        const leverage = Math.round(input.leverage ?? 1);
        if (!Number.isFinite(spend) || spend < (levCfg?.minTrade ?? MIN_TRADE_CENTS)) throw new Error(`Minimum trade is Ɱ ${((levCfg?.minTrade ?? MIN_TRADE_CENTS) / 100).toFixed(0)}`);
        // Per-market ceiling wins when set; otherwise the global config cap.
        const spendCap = m.maxBetCents ?? levCfg?.maxSpend ?? MAX_TRADE_SPEND_CENTS;
        if (spend > spendCap) throw new Error(`Max trade here is Ɱ ${(spendCap / 100).toFixed(0)}`);
        if (!TRADE_LEVERAGES.includes(leverage)) throw new Error("Bad leverage");
        const levCap = Math.min(m.maxLeverage, levCfg?.tMax ?? 100);
        if (leverage > levCap) throw new Error(`Max leverage here is ${levCap}×`);
        // Credit gate on the locked row — the pre-tx snapshot could be stale
        // if a repayment landed between page load and this trade.
        assertCreditLine(cur, leverage);
        const notional = spend * leverage;
        if (notional > MAX_TRADE_CENTS) throw new Error("Trade too large");
        notionalCents = notional;
        // One live option left → its YES is already certain; nothing to price.
        if (book && book.length <= 1) throw new Error("Sole surviving option — group is awaiting resolution");
        shares = coords
          ? multiSharesForSpend(coords, b, k, outcome, notional / 100)
          : sharesForSpend(qYes, qNo, b, outcome, notional / 100);
        if (shares <= 0) throw new Error("Trade too small");
        // Leveraged buys pay a funding fee on the borrowed notional — the
        // broker's spread — on top of the flat order fee.
        const levFee = levFeeCents(spend, leverage, levCfg?.feeBps ?? LEV_FEE_BPS);
        cashDelta = -(spend + orderFee + levFee); // collateral + fees; the loan makes up the rest
        feeCharge = orderFee + levFee;
        debtDelta = loanFor(spend, leverage);
      } else {
        shares = -Math.abs(input.shares ?? 0); // negative = removing shares from market
        if (!Number.isFinite(shares) || shares >= 0) throw new Error("Enter shares to sell");
        const [pos] = await tx
          .select()
          .from(schema.position)
          .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, u.id)))
          .limit(1);
        const held = toNum(outcome === "yes" ? pos?.yesShares ?? "0" : pos?.noShares ?? "0");
        if (held + 1e-9 < -shares) throw new Error("Not enough shares");
        shares = Math.max(shares, -held); // clamp float dust — never oversell
        // sell delta is negative — negate for proceeds
        const payout = -(coords
          ? multiTradeCost(coords, b, k, outcome, shares)
          : tradeCost(qYes, qNo, b, outcome, shares));
        cashDelta = Math.round(payout * 100); // nearest cent
        if (cashDelta <= 0) throw new Error("Nothing to refund");
        // Proceeds service the loan first, then the flat order fee comes off
        // the seller's take — capped so a tiny close can't go negative.
        debtRepay = Math.min(cashDelta, pos?.debtCents ?? 0);
        cashDelta -= debtRepay;
        feeCharge = Math.min(orderFee, cashDelta);
        cashDelta -= feeCharge;
        grossSellCents = Math.round(payout * 100);
        // Wall vow: the pledged share of sell proceeds feeds the debt
        // before the seller ever touches the cash.
        const vowSkim = Math.min(cashDelta, await garnishDebt(tx, u.id, cashDelta, `Sold ${outcome.toUpperCase()} @ ${m.question.slice(0, 40)}`));
        cashDelta -= vowSkim;
        if (vowSkim > 0) vowSkimCents = vowSkim;
      }

      const shareDelta = shares;
      const absShares = Math.abs(shareDelta);
      const newQYes = outcome === "yes" ? qYes + shareDelta : qYes;
      const newQNo = outcome === "no" ? qNo + shareDelta : qNo;
      let newPrice = yesPrice(newQYes, newQNo, b);
      let groupPrices: number[] | null = null;
      if (book) {
        // A YES moves the option's own coordinate; a NO is the complement
        // bundle and moves every sibling's.
        if (outcome === "yes") book[k].qYes += shareDelta;
        else book[k].qNo += shareDelta;
        groupPrices = multiPrices(multiCoords(book), b);
        newPrice = groupPrices[k];
      }

      // High leverage can be born dead: the buy's own price impact drops the
      // merged position's liquidation value under the cushion, so the same-tx
      // sweep would kill it on arrival and mint free volume. Reject instead.
      if (debtDelta > 0) {
        const [pos] = await tx
          .select()
          .from(schema.position)
          .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, u.id)))
          .limit(1);
        const py = toNum(pos?.yesShares ?? "0") + (outcome === "yes" ? shares : 0);
        const pn = toNum(pos?.noShares ?? "0") + (outcome === "no" ? shares : 0);
        const debt = (pos?.debtCents ?? 0) + debtDelta;
        const liqValue = book
          ? groupLiquidationValueCents(multiCoords(book), b, k, py, pn)
          : liquidationValueCents(newQYes, newQNo, b, py, pn);
        if (shouldLiquidate(liqValue, debt, m.maxLeverage))
          throw new Error("Too much leverage for this book — price impact would liquidate it instantly");
      }

      // The trade row carries the shares side of the money only; the flat
      // order fee rides its own "fee" ledger row so admin can sum fees apart
      // from wager/payout swings. Total balance delta is identical.
      await credit(
        tx,
        u.id,
        cashDelta + feeCharge,
        side === "buy" ? "buy" : "sell",
        marketId,
        `${side === "buy" ? "Bought" : "Sold"} ${absShares.toFixed(2)} ${outcome.toUpperCase()} @ ${(outcome === "yes" ? newPrice : 1 - newPrice).toFixed(2)}` +
          (debtDelta > 0 ? ` · ${input.leverage}x` : debtRepay > 0 ? " · loan repaid" : "") +
          (vowSkimCents > 0 ? ` · Ɱ${(vowSkimCents / 100).toFixed(2)} to debt` : "")
      );
      if (feeCharge > 0)
        await credit(tx, u.id, -orderFee, "fee", marketId, `${side === "buy" ? "Open" : "Close"} order fee — ${m.question.slice(0, 50)}`);
      const levFeeCharge = feeCharge - orderFee;
      if (levFeeCharge > 0)
        await credit(tx, u.id, -levFeeCharge, "fee", marketId, `Leverage fee — ${m.question.slice(0, 50)}`);

      // upsert position (shares delta + loan delta)
      const shareSet =
        outcome === "yes"
          ? { yesShares: sql`${schema.position.yesShares} + ${shareDelta}` }
          : { noShares: sql`${schema.position.noShares} + ${shareDelta}` };
      await tx
        .insert(schema.position)
        .values({
          marketId,
          userId: u.id,
          yesShares: outcome === "yes" ? String(shareDelta) : "0",
          noShares: outcome === "no" ? String(shareDelta) : "0",
          debtCents: debtDelta,
        })
        .onConflictDoUpdate({
          target: [schema.position.marketId, schema.position.userId],
          set:
            debtDelta === 0 && debtRepay === 0
              ? shareSet
              : {
                  ...shareSet,
                  debtCents: sql`${schema.position.debtCents} + ${debtDelta} - ${debtRepay}`,
                },
        });

      // trader count += when this is the user's first trade in this market
      const [prior] = await tx
        .select({ id: schema.trade.id })
        .from(schema.trade)
        .where(and(eq(schema.trade.marketId, marketId), eq(schema.trade.userId, u.id)))
        .limit(1);
      const wasFirst = !prior;

      // Volume counts the real position size moved: notional on buys, gross
      // payout on sells — loan mechanics stay out of the trending signal.
      const volCents = side === "buy" ? notionalCents : grossSellCents;
      const [updated] = await tx
        .update(schema.market)
        .set({
          qYes: String(book ? book[k].qYes : newQYes),
          qNo: String(book ? book[k].qNo : newQNo),
          volumeCents: sql`${schema.market.volumeCents} + ${volCents}`,
          traderCount: wasFirst ? sql`${schema.market.traderCount} + 1` : schema.market.traderCount,
        })
        .where(eq(schema.market.id, marketId))
        .returning({ slug: schema.market.slug });

      await tx.insert(schema.trade).values({
        marketId,
        userId: u.id,
        side,
        outcome,
        shares: String(absShares),
        amountCents: Math.abs(cashDelta),
        yesPriceAfter: newPrice.toFixed(5),
      });
      if (book && groupPrices) {
        // Every sibling repriced — one point each so all chart lines step
        // together.
        for (const [j, s] of book.entries()) {
          await tx.insert(schema.pricePoint).values({ marketId: s.m.id, yesPrice: groupPrices[j].toFixed(5) });
        }
      } else {
        await tx.insert(schema.pricePoint).values({ marketId, yesPrice: newPrice.toFixed(5) });
      }

      // The book just moved — flush any leveraged position that can't cover
      // its loan at the new prices, then fill resting take-profit/stop-loss
      // triggers, then re-check leverage (a stop fill can trip a cushion).
      if (book) {
        await checkGroupLiquidations(tx, book, levCfg?.debtRate);
        await runGroupStops(tx, book, orderFee);
        await checkGroupLiquidations(tx, book, levCfg?.debtRate);
      } else {
        await checkLiquidations(tx, marketId, levCfg?.debtRate);
        await runStops(tx, marketId, orderFee);
        await checkLiquidations(tx, marketId, levCfg?.debtRate);
      }

      result = { shares: absShares, costCents: Math.abs(cashDelta), price: newPrice };
      revalidatePath(`/market/${updated.slug}`);
      if (m.parentId) {
        // Traders land on the group page — refresh it too.
        const [parent] = await tx
          .select({ slug: schema.market.slug })
          .from(schema.market)
          .where(eq(schema.market.id, m.parentId))
          .limit(1);
        if (parent) revalidatePath(`/market/${parent.slug}`);
      }
    });

    revalidatePath("/");
    revalidatePath("/portfolio");
    revalidatePath("/leaderboard");
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Trade failed" };
  }
}

// ---------- position take-profit / stop-loss ----------
//
// Resting orders per side of a position: tp fills when the share price climbs
// to it, sl when it falls to it. sellPct caps each fill to a fraction of the
// side (default 100%); a fired trigger clears after one fill.

export async function setStops(input: {
  marketId: string;
  outcome: "yes" | "no";
  tpPrice: number | null;
  slPrice: number | null;
  sellPct?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const { marketId, outcome } = input;
    const tp = input.tpPrice == null ? null : Number(input.tpPrice);
    const sl = input.slPrice == null ? null : Number(input.slPrice);
    const pct = input.sellPct == null ? null : Math.round(Number(input.sellPct));
    for (const v of [tp, sl]) {
      if (v != null && (!Number.isFinite(v) || v <= 0 || v >= 1)) throw new Error("Trigger price must be between 0.01 and 0.99");
    }
    if (pct != null && (pct < 1 || pct > 100)) throw new Error("Sell percent must be between 1 and 100");
    if (tp != null && sl != null && tp <= sl) throw new Error("Take-profit must sit above stop-loss");
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (m.status !== "live") throw new Error("Market is not live");
      // The side's live price — group options price off the shared book.
      let pYes = yesPrice(toNum(m.qYes), toNum(m.qNo), m.b);
      if (m.parentId) {
        const sibs = await tx
          .select()
          .from(schema.market)
          .where(and(eq(schema.market.parentId, m.parentId), eq(schema.market.status, "live")))
          .for("update");
        const book = sibs.map((s) => ({ m: s, qYes: toNum(s.qYes), qNo: toNum(s.qNo), dirty: false }));
        const idx = book.findIndex((s) => s.m.id === marketId);
        if (idx >= 0 && book.length > 1) pYes = multiPrices(multiCoords(book), m.b)[idx];
      }
      const px = outcome === "yes" ? pYes : 1 - pYes;
      const [pos] = await tx
        .select()
        .from(schema.position)
        .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, u.id)))
        .for("update")
        .limit(1);
      const held = toNum(outcome === "yes" ? pos?.yesShares ?? "0" : pos?.noShares ?? "0");
      if (held <= 1e-9) throw new Error("No shares on this side");
      // A trigger at or past the live price would fire on the next trade
      // regardless of intent — reject it now instead of filling silently.
      if (tp != null && tp <= px) throw new Error("Take-profit must sit above the current price");
      if (sl != null && sl >= px) throw new Error("Stop-loss must sit below the current price");
      await tx
        .update(schema.position)
        .set(
          outcome === "yes"
            ? { tpYes: tp == null ? null : tp.toFixed(6), slYes: sl == null ? null : sl.toFixed(6), yesSellPct: pct }
            : { tpNo: tp == null ? null : tp.toFixed(6), slNo: sl == null ? null : sl.toFixed(6), noSellPct: pct }
        )
        .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, u.id)));
    });
    const [slugRow] = await db
      .select({ slug: schema.market.slug })
      .from(schema.market)
      .where(eq(schema.market.id, marketId))
      .limit(1);
    if (slugRow) revalidatePath(`/market/${slugRow.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to set triggers" };
  }
}

// ---------- wallet ----------

export async function claimDaily(): Promise<{
  ok: boolean;
  error?: string;
  amount?: number;
  retryInH?: number;
  retryInMs?: number;
}> {
  try {
    const u = await requireUser();
    const paid = await db.transaction(async (tx) => {
      const user = await lockUser(tx, u.id);
      const last = user.lastClaimAt ? new Date(user.lastClaimAt).getTime() : 0;
      const wait = DAILY_COOLDOWN_MS - (Date.now() - last);
      if (wait > 0) {
        const err = new Error("cooldown") as Error & { retryInH: number; retryInMs: number };
        err.retryInH = Math.ceil(wait / 3600000);
        err.retryInMs = wait;
        throw err;
      }
      const streak =
        last === 0 ? 1 : Date.now() - last <= STREAK_WINDOW_MS ? user.claimStreak + 1 : 1;
      const bonus = Math.min(streak, STREAK_CAP_DAYS) * STREAK_PER_DAY_CENTS;
      await tx
        .update(schema.user)
        .set({ lastClaimAt: new Date(), claimStreak: streak })
        .where(eq(schema.user.id, u.id));
      await credit(tx, u.id, DAILY_AMOUNT + bonus, "claim", null, `Daily faucet · day ${streak} streak`);
      return DAILY_AMOUNT + bonus;
    });
    revalidatePath("/");
    return { ok: true, amount: paid };
  } catch (e) {
    const { retryInH: h, retryInMs } = e as { retryInH?: number; retryInMs?: number };
    return { ok: false, error: e instanceof Error ? e.message : "Claim failed", retryInH: h, retryInMs };
  }
}

// Recurring rewards (weekly faucet, ad views) share one ledger table: latest
// claim per kind drives the cooldown; one-time bonuses use the unique index.
async function claimRecurring(
  kind: "weekly" | "ad",
  cooldownMs: number,
  amountCents: number,
  memo: string
): Promise<{ ok: boolean; error?: string; retryInH?: number }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      await lockUser(tx, u.id);
      const [last] = await tx
        .select({ createdAt: schema.rewardClaim.createdAt })
        .from(schema.rewardClaim)
        .where(and(eq(schema.rewardClaim.userId, u.id), eq(schema.rewardClaim.kind, kind)))
        .orderBy(desc(schema.rewardClaim.createdAt))
        .limit(1)
        .for("update");
      const wait = last ? cooldownMs - (Date.now() - new Date(last.createdAt).getTime()) : 0;
      if (wait > 0) {
        const err = new Error("cooldown") as Error & { retryInH: number };
        err.retryInH = Math.ceil(wait / 3600000);
        throw err;
      }
      await tx.insert(schema.rewardClaim).values({ userId: u.id, kind, amountCents });
      await credit(tx, u.id, amountCents, kind, null, memo);
    });
    revalidatePath("/rewards");
    return { ok: true };
  } catch (e) {
    const h = (e as { retryInH?: number }).retryInH;
    return { ok: false, error: e instanceof Error ? e.message : "Claim failed", retryInH: h };
  }
}

export async function claimWeekly() {
  return claimRecurring("weekly", WEEKLY_COOLDOWN_MS, WEEKLY_AMOUNT, "Weekly faucet");
}

export async function claimAdReward() {
  return claimRecurring("ad", AD_COOLDOWN_MS, AD_AMOUNT, "Ad reward");
}

// Milestone checks for claimBonus — each maps to real rows in the DB.
async function bonusMet(tx: Tx, cur: typeof schema.user.$inferSelect, check: string): Promise<boolean> {
  const one = async (q: Promise<unknown[]>) => (await q).length > 0;
  switch (check) {
    case "bet":
      return one(tx.select({ id: schema.trade.id }).from(schema.trade).where(eq(schema.trade.userId, cur.id)).limit(1));
    case "market":
      return one(tx.select({ id: schema.market.id }).from(schema.market).where(eq(schema.market.creatorId, cur.id)).limit(1));
    case "comment":
      return one(tx.select({ id: schema.comment.id }).from(schema.comment).where(eq(schema.comment.userId, cur.id)).limit(1));
    case "game":
      return one(tx.select({ id: schema.ledger.id }).from(schema.ledger).where(and(eq(schema.ledger.userId, cur.id), eq(schema.ledger.kind, "game"))).limit(1));
    case "win":
      // Genuine win rows carry "won ×n" (or "natural 21 ×n") — partial
      // returns, refunds, and side-bet payouts don't.
      return one(tx.select({ id: schema.ledger.id }).from(schema.ledger).where(and(eq(schema.ledger.userId, cur.id), eq(schema.ledger.kind, "game"), sql`${schema.ledger.amountCents} > 0`, sql`${schema.ledger.memo} ~ '(won|natural)'`)).limit(1));
    case "avatar":
      return !!cur.image;
    case "watchlist":
      return one(tx.select({ userId: schema.watchlist.userId }).from(schema.watchlist).where(eq(schema.watchlist.userId, cur.id)).limit(1));
    case "like":
      return one(tx.select({ userId: schema.marketLike.userId }).from(schema.marketLike).where(eq(schema.marketLike.userId, cur.id)).limit(1));
    case "duel":
      return one(tx.select({ id: schema.challenge.id }).from(schema.challenge).where(sql`${schema.challenge.creatorId} = ${cur.id} or ${schema.challenge.opponentId} = ${cur.id}`).limit(1));
    case "squad":
      return !!cur.squadId;
    case "tenTrades": {
      const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.trade).where(eq(schema.trade.userId, cur.id));
      return (r?.n ?? 0) >= 10;
    }
    case "streak7":
      return cur.claimStreak >= 7;
    case "sell":
      return one(tx.select({ id: schema.trade.id }).from(schema.trade).where(and(eq(schema.trade.userId, cur.id), eq(schema.trade.side, "sell"))).limit(1));
    case "note":
      return one(tx.select({ id: schema.communityNote.id }).from(schema.communityNote).where(eq(schema.communityNote.userId, cur.id)).limit(1));
    case "vote":
      return one(tx.select({ marketId: schema.resolutionVote.marketId }).from(schema.resolutionVote).where(eq(schema.resolutionVote.userId, cur.id)).limit(1));
    case "duelWin":
      return one(tx.select({ id: schema.challenge.id }).from(schema.challenge).where(eq(schema.challenge.winnerId, cur.id)).limit(1));
    case "squadOwner":
      return one(tx.select({ id: schema.squad.id }).from(schema.squad).where(eq(schema.squad.createdBy, cur.id)).limit(1));
    case "referrer":
      return one(tx.select({ id: schema.rewardClaim.id }).from(schema.rewardClaim).where(and(eq(schema.rewardClaim.userId, cur.id), sql`${schema.rewardClaim.kind} LIKE 'bonus:referrer:%'`)).limit(1));
    case "fiftyTrades": {
      const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.trade).where(eq(schema.trade.userId, cur.id));
      return (r?.n ?? 0) >= 50;
    }
    case "active7":
      return cur.activityStreak >= 7;
    default:
      return false;
  }
}

function bonusFail(check: string): string {
  const msgs: Record<string, string> = {
    bet: "Place a bet first",
    market: "Create a market first",
    comment: "Post a comment first",
    game: "Play a casino game first",
    win: "Win a game first",
    avatar: "Set an avatar first",
    watchlist: "Watchlist a market first",
    like: "Like a market first",
    duel: "Enter a duel first",
    squad: "Join a squad first",
    tenTrades: "Place ten trades first",
    streak7: "Keep a seven-day claim streak first",
    sell: "Sell a position first",
    note: "Write a community note first",
    vote: "Vote on a resolution first",
    duelWin: "Win a duel first",
    squadOwner: "Found a squad first",
    referrer: "Refer a friend first",
    fiftyTrades: "Place fifty trades first",
    active7: "Show up seven days running first",
  };
  return msgs[check] ?? "Not eligible yet";
}

export async function claimBonus(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const bonus = BONUS_MAP.get(key as never);
    if (!bonus) throw new Error("Unknown reward");

    await db.transaction(async (tx) => {
      const cur = await lockUser(tx, u.id);
      const [existing] = await tx
        .select({ id: schema.rewardClaim.id })
        .from(schema.rewardClaim)
        .where(and(eq(schema.rewardClaim.userId, u.id), eq(schema.rewardClaim.kind, `bonus:${key}`)))
        .limit(1);
      if (existing) throw new Error("Already claimed");

      // Milestone bonuses are verified against real activity.
      if (bonus.check && !(await bonusMet(tx, cur, bonus.check))) throw new Error(bonusFail(bonus.check));

      try {
        await tx.insert(schema.rewardClaim).values({ userId: u.id, kind: `bonus:${key}`, amountCents: bonus.amountCents });
      } catch {
        throw new Error("Already claimed"); // unique index raced us
      }
      await credit(tx, u.id, bonus.amountCents, "bonus", null, `Bonus: ${key}`);
    });
    revalidatePath("/rewards");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Claim failed" };
  }
}

// Avatar: client compresses to a ~256px JPEG data URL; kept in user.image.
export async function updateAvatar(image: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (image !== null) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new Error("Bad image format");
      if (image.length > 120_000) throw new Error("Image too large");
    }
    await db.update(schema.user).set({ image }).where(eq(schema.user.id, u.id));
    revalidatePath("/");
    revalidatePath("/portfolio");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed" };
  }
}

export async function grantBalance(input: {
  userId: string;
  amountCents: number;
  memo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    const amt = Math.round(input.amountCents);
    if (!Number.isFinite(amt) || amt === 0) throw new Error("Enter an amount");
    if (!Number.isSafeInteger(amt)) throw new Error("Amount too large");
    await db.transaction(async (tx) => {
      const cur = await lockUser(tx, input.userId);
      // Removing more than they hold zeroes the account instead of erroring.
      const delta = amt < 0 ? -Math.min(-amt, cur.balanceCents) : amt;
      if (delta === 0) throw new Error("Nothing to remove");
      await credit(tx, input.userId, delta, "grant", null, input.memo?.trim() || `Grant by ${admin.username ?? "admin"}`);
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Grant failed" };
  }
}

// ---------- casino tuning ----------

export async function setCasinoRig(input: { rigBps: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const bps = Math.round(Number(input.rigBps));
    if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) throw new Error("0–100% only");
    await db
      .insert(schema.casinoConfig)
      .values({ id: "house", rigBps: bps })
      .onConflictDoUpdate({ target: schema.casinoConfig.id, set: { rigBps: bps, updatedAt: new Date() } });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

// Kill-switch — toggle a game's stakes from the admin panel. In-flight rounds
// (blackjack hands, timer, hi-lo) still settle; only new stakes refuse.
export async function setGameEnabled(input: { game: string; enabled: boolean }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (!GAME_KEYS.includes(input.game as GameKey)) throw new Error("Unknown game");
    await db.transaction(async (tx) => {
      await tx.insert(schema.casinoConfig).values({ id: "house" }).onConflictDoNothing();
      const [cfg] = await tx.select({ d: schema.casinoConfig.disabledGames }).from(schema.casinoConfig).where(eq(schema.casinoConfig.id, "house")).for("update");
      const set = new Set(cfg?.d ?? []);
      if (input.enabled) set.delete(input.game);
      else set.add(input.game);
      await tx.update(schema.casinoConfig).set({ disabledGames: [...set], updatedAt: new Date() }).where(eq(schema.casinoConfig.id, "house"));
    });
    revalidatePath("/admin");
    revalidatePath("/games");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

// Leverage knobs: global caps for minigames and market orders, per-game
// overrides, and the funding-fee rate on borrowed notional. All read live at
// stake/trade time — raising a cap takes effect on the next bet.
export async function setLeverageConfig(input: {
  gameMaxLev: number;
  tradeMaxLev: number;
  levFeeBps: number;
  gameLevCaps: Record<string, number | null>;
  gameMaxBetCents: number;
  tradeMaxSpendCents: number;
  gameBetCaps: Record<string, number | null>;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const gMax = Math.round(Number(input.gameMaxLev));
    const tMax = Math.round(Number(input.tradeMaxLev));
    const feeBps = Math.round(Number(input.levFeeBps));
    const gBet = Math.round(Number(input.gameMaxBetCents));
    const tSpend = Math.round(Number(input.tradeMaxSpendCents));
    const leverMax = GAME_LEVERAGES[GAME_LEVERAGES.length - 1];
    const tradeLeverMax = TRADE_LEVERAGES[TRADE_LEVERAGES.length - 1];
    if (!Number.isFinite(gMax) || gMax < 1 || gMax > leverMax) throw new Error(`Game cap 1–${leverMax}× only`);
    if (!Number.isFinite(tMax) || tMax < 1 || tMax > tradeLeverMax) throw new Error(`Market cap 1–${tradeLeverMax}× only`);
    if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 5000) throw new Error("Funding fee 0–50% only");
    if (!Number.isFinite(gBet) || gBet < 100 || gBet > 100_000_000) throw new Error("Game max bet Ɱ1–Ɱ1,000,000 only");
    if (!Number.isFinite(tSpend) || tSpend < 1000 || tSpend > 100_000_000) throw new Error("Market max trade Ɱ10–Ɱ1,000,000 only");
    const caps: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.gameLevCaps ?? {})) {
      if (!GAME_KEYS.includes(k as GameKey) || v == null) continue;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 1 || n > leverMax) throw new Error(`Per-game cap 1–${leverMax}× only`);
      if (n !== gMax) caps[k] = n; // same-as-global entries are noise
    }
    const betCaps: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.gameBetCaps ?? {})) {
      if (!GAME_KEYS.includes(k as GameKey) || v == null) continue;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 100 || n > 100_000_000) throw new Error("Per-game max bet Ɱ1–Ɱ1,000,000 only");
      if (n !== gBet) betCaps[k] = n;
    }
    const set = {
      gameMaxLev: gMax,
      tradeMaxLev: tMax,
      levFeeBps: feeBps,
      gameLevCaps: Object.keys(caps).length ? caps : null,
      gameMaxBetCents: gBet,
      tradeMaxSpendCents: tSpend,
      gameBetCaps: Object.keys(betCaps).length ? betCaps : null,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.casinoConfig)
      .values({ id: "house", ...set })
      .onConflictDoUpdate({ target: schema.casinoConfig.id, set });
    revalidatePath("/admin");
    revalidatePath("/games");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

// House rules — the batch of knobs that used to live in lib/games.ts and
// lib/loans.ts: session limits, flat fees, loan APR, referral royalties,
// dice/limbo odds, minimum trade, and the autobet kill-switch.
export async function setGameRules(input: {
  autobetEnabled: boolean;
  gameDailyLimitMs: number;
  gameIdleMs: number;
  gameFeeCents: number;
  tradeFeeCents: number;
  debtRateBps: number;
  referralRoyaltyBps: number;
  referralRoyaltyCapCents: number;
  dicePayBps: number;
  limboPayBps: number;
  limboMinX100: number;
  minTradeCents: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const hrs = Math.round(Number(input.gameDailyLimitMs));
    const idle = Math.round(Number(input.gameIdleMs));
    const gFee = Math.round(Number(input.gameFeeCents));
    const tFee = Math.round(Number(input.tradeFeeCents));
    const apr = Math.round(Number(input.debtRateBps));
    const royBps = Math.round(Number(input.referralRoyaltyBps));
    const royCap = Math.round(Number(input.referralRoyaltyCapCents));
    const dicePay = Math.round(Number(input.dicePayBps));
    const limboPay = Math.round(Number(input.limboPayBps));
    const limboMin = Math.round(Number(input.limboMinX100));
    const minTrade = Math.round(Number(input.minTradeCents));
    if (!Number.isFinite(hrs) || hrs < 60_000 || hrs > GAME_WINDOW_MS) throw new Error("Daily limit 1m–24h only");
    if (!Number.isFinite(idle) || idle < 60_000 || idle > GAME_WINDOW_MS) throw new Error("Idle gap 1m–24h only");
    if (!Number.isFinite(gFee) || gFee < 0 || gFee > 100_000) throw new Error("Game fee Ɱ0–Ɱ1,000 only");
    if (!Number.isFinite(tFee) || tFee < 0 || tFee > 100_000) throw new Error("Trade fee Ɱ0–Ɱ1,000 only");
    if (!Number.isFinite(apr) || apr < 0 || apr > 100_000) throw new Error("Debt APR 0–1000% only");
    if (!Number.isFinite(royBps) || royBps < 0 || royBps > 10_000) throw new Error("Royalty rate 0–100% only");
    if (!Number.isFinite(royCap) || royCap < 0 || royCap > 1_000_000_000) throw new Error("Royalty cap Ɱ0–Ɱ10,000,000 only");
    if (!Number.isFinite(dicePay) || dicePay < 1000 || dicePay > 10_000) throw new Error("Dice payout 10–100% only");
    if (!Number.isFinite(limboPay) || limboPay < 1000 || limboPay > 10_000) throw new Error("Limbo payout 10–100% only");
    if (!Number.isFinite(limboMin) || limboMin < 101 || limboMin > 10_000) throw new Error("Limbo min target 1.01–100× only");
    if (!Number.isFinite(minTrade) || minTrade < 0 || minTrade > 10_000_000) throw new Error("Min trade Ɱ0–Ɱ100,000 only");
    const set = {
      autobetEnabled: input.autobetEnabled === true,
      gameDailyLimitMs: hrs,
      gameIdleMs: idle,
      gameFeeCents: gFee,
      tradeFeeCents: tFee,
      debtRateBps: apr,
      referralRoyaltyBps: royBps,
      referralRoyaltyCapCents: royCap,
      dicePayBps: dicePay,
      limboPayBps: limboPay,
      limboMinX100: limboMin,
      minTradeCents: minTrade,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.casinoConfig)
      .values({ id: "house", ...set })
      .onConflictDoUpdate({ target: schema.casinoConfig.id, set });
    revalidatePath("/admin");
    revalidatePath("/games");
    revalidatePath("/rewards");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

// Player toggle — auto-repay: every settled win and every new stake/trade
// sweeps spare balance into the outstanding loan first.
export async function setAutoRepay(input: { enabled: boolean }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.update(schema.user).set({ autoRepay: input.enabled === true }).where(eq(schema.user.id, u.id));
    revalidatePath("/games");
    revalidatePath("/portfolio");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

// Reset the open daily-jackpot round — the live pool is computed from wagers
// since starts_at, so a reset moves the window's start to now (pool and
// tickets recompute to zero; the next draw time is unchanged).
export async function resetJackpot(): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.update(schema.jackpotRound).set({ startsAt: new Date(), poolCents: 0, tickets: 0 }).where(isNull(schema.jackpotRound.drawnAt));
    revalidatePath("/admin");
    revalidatePath("/games");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reset failed" };
  }
}

// Economy reset — the whale fix. The heavy lifting lives in
// lib/economy-reset.ts so scripts/reset-economy.ts runs the identical
// transaction; this wrapper adds auth + revalidation.
export async function adminResetEconomy(): Promise<{ ok: boolean; error?: string; unwound?: number; clamped?: number; purgedTrades?: number; recounted?: number }> {
  try {
    await requireAdmin();
    const r = await db.transaction((tx) => resetEconomyTx(tx, { exemptEmail: SUPER_ADMIN_EMAIL }));
    revalidatePath("/admin");
    revalidatePath("/markets");
    revalidatePath("/leaderboard");
    revalidatePath("/");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reset failed" };
  }
}

export async function setUserLuck(input: { userId: string; luckBps: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const bps = Math.round(Number(input.luckBps));
    if (!Number.isFinite(bps) || bps < -5000 || bps > 5000) throw new Error("-50% to +50% only");
    await db.update(schema.user).set({ luckBps: bps }).where(eq(schema.user.id, input.userId));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

// ---------- markets ----------

// Everyone can open a live market. The creator sets the starting odds and
// liquidity; the LMSR takes it from there.
const LIQUIDITY_OPTIONS = [300, 1000, 3000] as const;
// New books default to deep liquidity — early trades move the price 3× less.
const DEFAULT_LIQUIDITY = 3000;

const NEW_CATEGORY = "__new__";

function normalizeCategory(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) throw new Error("Category required");
  if (s.length > 24) throw new Error("Category name too long (max 24)");
  return s;
}

// Resolves the market's category: an existing one, or a brand-new user-defined
// one created on the fly (case-insensitive dedupe).
async function resolveCategory(tx: Tx, input: { category: string; newCategory?: string }, userId: string) {
  if (input.category !== NEW_CATEGORY) return input.category;
  const name = normalizeCategory(input.newCategory ?? "");
  const [existing] = await tx
    .select({ name: schema.category.name })
    .from(schema.category)
    .where(sql`lower(${schema.category.name}) = lower(${name})`)
    .limit(1);
  if (existing) return existing.name;
  const [max] = await tx.select({ n: sql<number>`coalesce(max(${schema.category.sortIndex}),0)::int` }).from(schema.category);
  await tx.insert(schema.category).values({ name, sortIndex: (max?.n ?? 0) + 1, creatorId: userId });
  return name;
}

export async function createCategory(input: { name: string }): Promise<{ ok: boolean; error?: string; name?: string }> {
  try {
    const u = await requireUser();
    const name = await db.transaction(async (tx) => {
      const n = normalizeCategory(input.name);
      const [existing] = await tx
        .select({ name: schema.category.name })
        .from(schema.category)
        .where(sql`lower(${schema.category.name}) = lower(${n})`)
        .limit(1);
      if (existing) return existing.name;
      const [max] = await tx.select({ n: sql<number>`coalesce(max(${schema.category.sortIndex}),0)::int` }).from(schema.category);
      await tx.insert(schema.category).values({ name: n, sortIndex: (max?.n ?? 0) + 1, creatorId: u.id });
      return n;
    });
    revalidatePath("/");
    revalidatePath("/admin");
    updateTag("categories");
    return { ok: true, name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create category" };
  }
}

export async function renameCategory(input: { from: string; to: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const to = normalizeCategory(input.to);
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ name: schema.category.name })
        .from(schema.category)
        .where(sql`lower(${schema.category.name}) = lower(${to})`)
        .limit(1);
      if (existing && existing.name !== input.from) throw new Error("A category with that name exists");
      await tx.update(schema.category).set({ name: to }).where(eq(schema.category.name, input.from));
      await tx.update(schema.market).set({ category: to }).where(eq(schema.market.category, input.from));
    });
    revalidatePath("/");
    revalidatePath("/admin");
    updateTag("categories");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rename failed" };
  }
}

export async function reorderCategories(input: { names: string[] }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.transaction(async (tx) => {
      for (const [i, name] of input.names.entries()) {
        await tx.update(schema.category).set({ sortIndex: i + 1 }).where(eq(schema.category.name, name));
      }
    });
    revalidatePath("/");
    revalidatePath("/admin");
    updateTag("categories");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reorder failed" };
  }
}

export async function deleteCategory(input: { name: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.market)
      .where(eq(schema.market.category, input.name));
    if ((used?.n ?? 0) > 0) throw new Error(`Category is used by ${used.n} market(s)`);
    await db.delete(schema.category).where(eq(schema.category.name, input.name));
    revalidatePath("/");
    revalidatePath("/admin");
    updateTag("categories");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function proposeMarket(input: {
  question: string;
  description: string;
  context?: string; // background shown in the Market context card
  imageUrl?: string; // market icon — URL or data:image from the form's cell
  category: string;
  newCategory?: string;
  closesAt?: string;
  opensAt?: string; // trading blocked until then — clones roll it forward
  initialProb?: number;
  liquidity?: number;
  outcomes?: string[];
  optionProbs?: number[]; // per-option opening odds in %, parallel to outcomes
  recurDays?: number; // auto-clone the market this many days after close
  maxLeverage?: number; // leverage ceiling for buys — defaults to 10x
  maxBetCents?: number | null; // own-cash spend cap per order — null = global
}): Promise<{ ok: boolean; error?: string; slug?: string; live?: boolean }> {
  try {
    const u = await requireUser();
    const question = input.question.trim();
    if (question.length < 10) throw new Error("Question too short (min 10 chars)");
    if (question.length > 200) throw new Error("Question too long (max 200)");
    if (input.description.length > 5000) throw new Error("Description too long");
    const context = (input.context ?? "").trim().slice(0, 2000);
    const b = LIQUIDITY_OPTIONS.includes(input.liquidity as 300) ? input.liquidity! : DEFAULT_LIQUIDITY;
    const p = Math.min(0.97, Math.max(0.03, input.initialProb ?? 0.5));
    const description = input.description.trim();
    const recurDays = [1, 7, 14, 30].includes(input.recurDays ?? 0) ? input.recurDays! : null;
    // No explicit close on a recurring market → the first run closes one
    // period out, so "Daily" actually means closes-every-day.
    const closesAt = input.closesAt
      ? new Date(input.closesAt)
      : recurDays
        ? new Date(Date.now() + recurDays * 24 * 3600 * 1000)
        : null;
    if (closesAt && Number.isNaN(closesAt.getTime())) throw new Error("Bad close date");
    // Scheduled open — trades reject until opens_at. Must precede the close.
    const opensAt = input.opensAt ? new Date(input.opensAt) : null;
    if (opensAt && Number.isNaN(opensAt.getTime())) throw new Error("Bad open date");
    if (opensAt && closesAt && opensAt >= closesAt) throw new Error("Open must be before close");
    const [levCfg] = await db
      .select({ tMax: schema.casinoConfig.tradeMaxLev })
      .from(schema.casinoConfig)
      .where(eq(schema.casinoConfig.id, "house"));
    // Per-market ceiling can't exceed the global cap — the ticket intersects
    // both anyway, but storing the effective value keeps admins honest.
    const maxLeverage = Math.min(TRADE_LEVERAGES.includes(input.maxLeverage ?? 10) ? input.maxLeverage! : 10, levCfg?.tMax ?? 100);
    const maxBetCents =
      input.maxBetCents == null
        ? null
        : (() => {
            const n = Math.round(Number(input.maxBetCents));
            if (!Number.isFinite(n) || n < 1000 || n > 100_000_000) throw new Error("Max trade Ɱ10–Ɱ1,000,000 only");
            return n;
          })();
    const marketImage = input.imageUrl?.trim() || null;
    if (marketImage) {
      const isData = /^data:image\/(jpeg|png|webp);base64,/.test(marketImage) || /^data:image\/svg\+xml[;,]/.test(marketImage);
      if (!isData && !/^(https?:\/\/|\/)\S+$/.test(marketImage)) throw new Error("Bad image URL");
      if (isData && marketImage.length > 450_000) throw new Error("Image too large");
    }

    // Options may carry an image: "Democratic Party | https://…/logo.png" —
    // data URLs come from the form's upload/paste cell.
    // optionProbs aligns with the raw outcome lines — carry it through the
    // parse so deduping a label can't shift every later option's odds.
    const parsed = (input.outcomes ?? [])
      .map((o, i) => ({ line: o.trim(), prob: input.optionProbs?.[i] }))
      .filter((x) => x.line)
      .map(({ line, prob }) => {
        const [label, url] = line.split("|").map((s) => s.trim());
        if (url) {
          const isData = /^data:image\/(jpeg|png|webp);base64,/.test(url) || /^data:image\/svg\+xml[;,]/.test(url);
          const isUrl = /^(https?:\/\/|\/)\S+$/.test(url);
          if (!isData && !isUrl) throw new Error(`Bad image URL for "${label}"`);
          if (isData && url.length > 450_000) throw new Error(`Image too large for "${label}"`);
        }
        return { label, imageUrl: url || null, prob };
      });
    const seen = new Set<string>();
    const options = parsed.filter((o) => (seen.has(o.label.toLowerCase()) ? false : (seen.add(o.label.toLowerCase()), true)));
    if (options.length === 1) throw new Error("Add at least 2 options, or leave options empty");
    if (options.length > 12) throw new Error("Max 12 options");
    if (options.some((o) => o.label.length > 60 || o.label.length === 0)) throw new Error("Option labels max 60 chars");

    const slug = await db.transaction(async (tx) => {
      const category = await resolveCategory(tx, input, u.id);
      if (options.length >= 2) {
        const [parent] = await tx
          .insert(schema.market)
          .values({
            slug: await uniqueSlug(tx),
            question,
            description,
            context,
            category,
            status: "live",
            kind: "group",
            creatorId: u.id,
            b,
            opensAt,
            closesAt,
            recurDays,
            maxLeverage,
            maxBetCents,
            imageUrl: marketImage,
          })
          .returning({ id: schema.market.id, slug: schema.market.slug });
        const base = question.replace(/[?？!.\s]+$/g, "");
        // Options are exclusive — the shared book needs probabilities summing
        // to 1, so the submitted per-option odds act as weights. Missing or
        // junk values fall back to the shared slider.
        const weights = options.map((opt) => {
          const raw = opt.prob ?? p * 100;
          return Math.max(0.1, Number.isFinite(raw) ? raw : p * 100);
        });
        const wSum = weights.reduce((a, w) => a + w, 0);
        for (const [i, opt] of options.entries()) {
          const { label } = opt;
          const pi = weights[i] / wSum;
          const [child] = await tx
            .insert(schema.market)
            .values({
              slug: await uniqueSlug(tx),
              question: `${base} — ${label}?`,
              description,
              category,
              status: "live",
              kind: "option",
              parentId: parent.id,
              label,
              imageUrl: opt.imageUrl,
              sortIndex: i,
              creatorId: u.id,
              b,
              qYes: multiQForProb(pi, b).toFixed(6),
              qNo: "0",
              volumeCents: houseSeedCents(b),
              seedCents: houseSeedCents(b),
              opensAt,
              closesAt,
              maxLeverage,
              maxBetCents,
            })
            .returning({ id: schema.market.id });
          await tx.insert(schema.pricePoint).values({ marketId: child.id, yesPrice: pi.toFixed(5) });
        }
        return parent.slug;
      }

      const [m] = await tx
        .insert(schema.market)
        .values({
          slug: await uniqueSlug(tx),
          question,
          description,
          context,
          category,
          status: "live",
          creatorId: u.id,
          b,
          qYes: qForProb(p, b).toFixed(6),
          qNo: "0",
          volumeCents: houseSeedCents(b),
          seedCents: houseSeedCents(b),
          opensAt,
          closesAt,
          recurDays,
          maxLeverage,
          maxBetCents,
          imageUrl: marketImage,
        })
        .returning({ id: schema.market.id, slug: schema.market.slug });
      await tx.insert(schema.pricePoint).values({ marketId: m.id, yesPrice: p.toFixed(5) });
      return m.slug;
    });

    revalidatePath("/admin");
    revalidatePath("/");
    updateTag("categories");
    return { ok: true, slug, live: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create market" };
  }
}

export async function approveMarket(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (m.status !== "pending") throw new Error("Not pending");
      await tx.update(schema.market).set({ status: "live" }).where(eq(schema.market.id, marketId));
      await tx.insert(schema.pricePoint).values({ marketId, yesPrice: marketYesPrice(m).toFixed(5) });
    });
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Approve failed" };
  }
}

export async function rejectMarket(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (m.status !== "pending") throw new Error("Not pending");
      await tx.update(schema.market).set({ status: "rejected" }).where(eq(schema.market.id, marketId));
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reject failed" };
  }
}

// Creator or admin can edit a market. Once bets exist, the question itself is
// locked — changing what traders bet on mid-flight is what breaks a live
// prediction. Rules text, category, image, and the close date stay editable.
export async function updateMarket(input: {
  marketId: string;
  question: string;
  description: string;
  context?: string;
  category: string;
  imageUrl?: string;
  closesAt?: string;
  opensAt?: string;
  b?: number;
  recurDays?: number | null;
  maxLeverage?: number;
  maxBetCents?: number | null; // undefined keeps the stored cap; null = global
  options?: { id: string; label: string; imageUrl?: string }[];
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const m = await db.select().from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (!m[0]) throw new Error("Market not found");
    const admin = isAdmin(u);
    if (!admin && m[0].creatorId !== u.id) throw new Error("Only the creator or an admin can edit");
    if (m[0].status === "resolved") throw new Error("Cannot edit resolved market");
    if (input.imageUrl && !/^(https?:\/\/|\/)\S+$/.test(input.imageUrl.trim()) && !/^data:image\/(jpeg|png|webp);base64,|^data:image\/svg\+xml[;,]/.test(input.imageUrl.trim())) throw new Error("Bad image URL");

    const question = input.question.trim();
    if (question.length < 10) throw new Error("Question too short (min 10 chars)");
    if (question.length > 200) throw new Error("Question too long (max 200)");
    if (input.description.length > 5000) throw new Error("Description too long");
    const categoryInput = normalizeCategory(input.category);

    // Schedule: undefined keeps the stored value, "" clears it, a string must
    // parse. Options take the parent's schedule — never edited directly.
    const isOpt = m[0].kind === "option";
    const closesAt =
      isOpt || input.closesAt === undefined ? m[0].closesAt : input.closesAt ? new Date(input.closesAt) : null;
    const opensAt =
      isOpt || input.opensAt === undefined ? m[0].opensAt : input.opensAt ? new Date(input.opensAt) : null;
    if (closesAt && Number.isNaN(closesAt.getTime())) throw new Error("Bad close date");
    if (opensAt && Number.isNaN(opensAt.getTime())) throw new Error("Bad open date");
    if (opensAt && closesAt && opensAt >= closesAt) throw new Error("Open must be before close");

    const questionLocked = question !== m[0].question;
    const bChanged = admin && input.b && input.b > 0 && input.b !== m[0].b;
    const bets = questionLocked || bChanged ? await getMarketBetCount(m[0].id) : 0;
    if (questionLocked && bets > 0) throw new Error("Question is locked once bets are placed");
    // Repricing b mid-flight revalues every open position + its loan ratio —
    // lock it once the book has trades.
    if (bChanged && bets > 0) throw new Error("Liquidity is locked once bets are placed");

    // Recurrence + leverage are caps read per-trade/per-resolve — safe to edit
    // on a live book. Options inherit both from their parent.
    const recurDays = isOpt || input.recurDays === undefined
      ? m[0].recurDays
      : [1, 7, 14, 30].includes(input.recurDays ?? 0)
        ? input.recurDays
        : null;
    const [levCfg] = await db
      .select({ tMax: schema.casinoConfig.tradeMaxLev })
      .from(schema.casinoConfig)
      .where(eq(schema.casinoConfig.id, "house"));
    const maxLeverage = Math.min(
      input.maxLeverage !== undefined && TRADE_LEVERAGES.includes(input.maxLeverage)
        ? input.maxLeverage
        : m[0].maxLeverage,
      levCfg?.tMax ?? 100
    );
    // Spend ceiling — same live-edit rules as leverage; undefined keeps the
    // stored value, null resets to the global config cap.
    const maxBetCents =
      input.maxBetCents === undefined
        ? m[0].maxBetCents
        : input.maxBetCents === null
          ? null
          : (() => {
              const n = Math.round(Number(input.maxBetCents));
              if (!Number.isFinite(n) || n < 1000 || n > 100_000_000) throw new Error("Max trade Ɱ10–Ɱ1,000,000 only");
              return n;
            })();

    // Option renames/image swaps are display-only — positions and the book key
    // on the option's id, not its label. Each entry must name a real child.
    const optionEdits =
      m[0].kind === "group" && input.options?.length
        ? input.options.map((o) => ({
            id: o.id,
            label: o.label.trim().slice(0, 60),
            imageUrl: o.imageUrl?.trim() ?? "",
          }))
        : [];
    for (const o of optionEdits) {
      if (!o.label) throw new Error("Option label can't be empty");
      if (o.imageUrl && !/^(https?:\/\/|\/)\S+$/.test(o.imageUrl) && !/^data:image\/(jpeg|png|webp);base64,|^data:image\/svg\+xml[;,]/.test(o.imageUrl))
        throw new Error("Bad option image URL");
    }

    await db.transaction(async (tx) => {
      // Category must resolve to a real row — match case-insensitively, else
      // create it the same way the propose form does (it's a user feature).
      let category = categoryInput;
      const [catRow] = await tx
        .select({ name: schema.category.name })
        .from(schema.category)
        .where(sql`lower(${schema.category.name}) = lower(${categoryInput})`)
        .limit(1);
      if (catRow) category = catRow.name;
      else {
        const [max] = await tx.select({ n: sql<number>`coalesce(max(${schema.category.sortIndex}),0)::int` }).from(schema.category);
        await tx.insert(schema.category).values({ name: category, sortIndex: (max?.n ?? 0) + 1, creatorId: u.id });
      }
      await tx
        .update(schema.market)
        .set({
          question,
          description: input.description.trim(),
          context: input.context !== undefined ? input.context.trim().slice(0, 2000) : m[0].context,
          category,
          imageUrl: input.imageUrl !== undefined ? input.imageUrl.trim() || null : m[0].imageUrl,
          closesAt,
          opensAt,
          recurDays,
          maxLeverage,
          maxBetCents,
          b: bChanged ? input.b! : m[0].b,
        })
        .where(eq(schema.market.id, input.marketId));
      // Group children inherit the parent's category, schedule, leverage cap,
      // and book depth in the same transaction — a divergent option would keep
      // trading under the old window (its own closesAt is what placeTrade
      // checks) or price off a different b than its siblings' shared book.
      if (m[0].kind === "group") {
        await tx
          .update(schema.market)
          .set({ category, closesAt, opensAt, maxLeverage, maxBetCents, b: bChanged ? input.b! : m[0].b })
          .where(eq(schema.market.parentId, input.marketId));
        for (const o of optionEdits) {
          await tx
            .update(schema.market)
            .set({ label: o.label, imageUrl: o.imageUrl || null })
            .where(and(eq(schema.market.id, o.id), eq(schema.market.parentId, input.marketId)));
        }
      }
    });
    revalidatePath(`/market/${m[0].slug}`);
    revalidatePath("/admin");
    revalidatePath("/");
    updateTag("categories");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

// Shared settle path — pays positions, closes the market, notifies watchers,
// and clones recurring markets. Called by direct resolves and by the
// community vote threshold.
async function settleMarketTx(
  tx: Tx,
  m: typeof schema.market.$inferSelect,
  outcome: "yes" | "no",
  reason: string
): Promise<number> {
  let paidOut = 0;
  const positions = await tx
    .select()
    .from(schema.position)
    .where(eq(schema.position.marketId, m.id))
    .for("update");
  for (const p of positions) {
    const winShares = outcome === "yes" ? toNum(p.yesShares) : toNum(p.noShares);
    // Leveraged positions settle the loan first; winners keep the rest.
    const payout = Math.max(0, Math.floor(winShares * 100) - p.debtCents);
    if (payout > 0) {
      await lockUser(tx, p.userId);
      const skim = Math.min(payout, await garnishDebt(tx, p.userId, payout, `Payout: ${m.question.slice(0, 40)}`));
      await credit(tx, p.userId, payout - skim, "payout", m.id, `Payout: ${m.question.slice(0, 60)}`);
      paidOut += payout - skim;
    } else {
      // Held shares but took nothing — losing holders get a bell row too,
      // otherwise their position just silently vanishes.
      await lockUser(tx, p.userId);
      await ping(tx, p.userId, `Resolved ${outcome.toUpperCase()} — your shares lost: ${m.question.slice(0, 60)}`, m.id);
    }
  }
  await tx.delete(schema.position).where(eq(schema.position.marketId, m.id));
  await tx
    .update(schema.market)
    .set({
      status: "resolved",
      outcome,
      resolvedAt: new Date(),
      resolutionReason: reason,
      proposedOutcome: null,
      proposedById: null,
      proposedAt: null,
    })
    .where(eq(schema.market.id, m.id));
  await tx.delete(schema.resolutionVote).where(eq(schema.resolutionVote.marketId, m.id));
  await tx.insert(schema.pricePoint).values({
    marketId: m.id,
    yesPrice: outcome === "yes" ? "1" : "0",
  });
  // Fan out to watchers + the creator — position holders already got a
  // payout or a loss row, so only notify users who held nothing.
  const paidUsers = new Set(positions.map((p) => p.userId));
  const watchers = await tx
    .select({ userId: schema.watchlist.userId })
    .from(schema.watchlist)
    .where(eq(schema.watchlist.marketId, m.id));
  const notifyIds = new Set([m.creatorId, ...watchers.map((w) => w.userId)].filter((x): x is string => !!x));
  for (const uid of notifyIds) {
    if (paidUsers.has(uid)) continue;
    const [w] = await tx
      .select({ notifResolve: schema.user.notifResolve })
      .from(schema.user)
      .where(eq(schema.user.id, uid))
      .limit(1);
    if (!w || !w.notifResolve) continue;
    await ping(tx, uid, `Resolved ${outcome.toUpperCase()}: ${m.question.slice(0, 80)}`, m.id);
  }
  await syncGroupStatus(tx, m);

  // Options are mutually exclusive under the shared book: a YES winner
  // settles the whole group — every live sibling auto-resolves NO and pays
  // its no-holders. A NO resolution just drops the option's coordinate, so
  // the survivors get a fresh point each at the renormalized prices.
  if (m.parentId) {
    const sibs = await tx
      .select()
      .from(schema.market)
      .where(
        and(
          eq(schema.market.parentId, m.parentId),
          eq(schema.market.status, "live"),
          ne(schema.market.id, m.id)
        )
      )
      .orderBy(asc(schema.market.id))
      .for("update");
    if (outcome === "yes") {
      for (const sib of sibs) {
        paidOut += await settleMarketTx(tx, sib, "no", `Sibling "${m.label ?? m.question.slice(0, 40)}" won`);
      }
    } else {
      const prices = multiPrices(
        multiCoords(sibs.map((s) => ({ qYes: toNum(s.qYes), qNo: toNum(s.qNo) }))),
        m.b
      );
      for (const [j, s] of sibs.entries()) {
        await tx.insert(schema.pricePoint).values({ marketId: s.id, yesPrice: prices[j].toFixed(5) });
      }
    }
  }

  // Recurring markets: open a fresh copy closing recurDays after this close.
  // Groups recur from syncGroupStatus once every option has settled.
  if (m.recurDays && !m.parentId && m.kind !== "group") {
    const recurMs = m.recurDays * 24 * 3600 * 1000;
    // Roll forward — a late resolution must not birth an already-closed clone.
    let periods = 1;
    let nextClose = new Date((m.closesAt?.getTime() ?? Date.now()) + recurMs);
    while (nextClose.getTime() <= Date.now()) {
      nextClose = new Date(nextClose.getTime() + recurMs);
      periods++;
    }
    const nextOpen = m.opensAt ? new Date(m.opensAt.getTime() + periods * recurMs) : null;
    // Seed the clone with this market's opening price — flat 50% on a 90%
    // daily market is free money for the first trader of every cycle.
    const [seed] = await tx
      .select({ yesPrice: schema.pricePoint.yesPrice })
      .from(schema.pricePoint)
      .where(eq(schema.pricePoint.marketId, m.id))
      .orderBy(asc(schema.pricePoint.createdAt))
      .limit(1);
    const seedP = Math.min(0.99, Math.max(0.01, toNum(seed?.yesPrice ?? "0.5")));
    const [clone] = await tx
      .insert(schema.market)
      .values({
        slug: await uniqueSlug(tx),
        question: m.question,
        description: m.description,
        context: m.context,
        category: m.category,
        status: "live",
        kind: "binary",
        creatorId: m.creatorId,
        b: m.b,
        qYes: qForProb(seedP, m.b).toFixed(6),
        qNo: "0",
        volumeCents: houseSeedCents(m.b),
        seedCents: houseSeedCents(m.b),
        recurDays: m.recurDays,
        maxLeverage: m.maxLeverage,
        imageUrl: m.imageUrl,
        opensAt: nextOpen,
        closesAt: nextClose,
      })
      .returning({ id: schema.market.id });
    await tx.insert(schema.pricePoint).values({ marketId: clone.id, yesPrice: seedP.toFixed(5) });
  }
  return paidOut;
}

export async function resolveMarket(input: {
  marketId: string;
  outcome: "yes" | "no";
  reason?: string;
}): Promise<{ ok: boolean; error?: string; paidOut?: number }> {
  try {
    const u = await requireUser();
    if (input.outcome !== "yes" && input.outcome !== "no") throw new Error("Bad outcome");
    let paidOut = 0;
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (!isAdmin(u) && m.creatorId !== u.id) throw new Error("Only the creator or an admin can resolve");
      if (m.kind === "group") throw new Error("Resolve the group's options instead");
      if (m.status !== "live") throw new Error("Market is not live");
      // A disputed market is out of the creator's hands — only admins settle it.
      const [d] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.resolutionVote)
        .where(and(eq(schema.resolutionVote.marketId, m.id), eq(schema.resolutionVote.vote, "dispute")));
      if ((d?.n ?? 0) > 0 && !isAdmin(u)) throw new Error("Resolution is disputed — an admin must resolve");
      // Community-note gate: more than NOTE_ADMIN_GATE notes means the crowd
      // is weighing in — the market creator can't self-resolve, only an admin.
      const [nc] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.communityNote)
        .where(eq(schema.communityNote.marketId, m.id));
      if ((nc?.n ?? 0) > NOTE_ADMIN_GATE && !isAdmin(u))
        throw new Error("This market has 6+ community notes — an admin must resolve it");
      paidOut = await settleMarketTx(tx, m, input.outcome, (input.reason ?? "").trim().slice(0, 500));
    });
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/leaderboard");
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    return { ok: true, paidOut };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Resolve failed" };
  }
}

// Community resolution — the resolver (creator/admin) may declare the outcome
// at any time; once the market has closed, anyone signed in may propose. Two
// confirm votes settle it, disputes send it to admins.
export async function proposeResolution(input: {
  marketId: string;
  outcome: "yes" | "no";
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (input.outcome !== "yes" && input.outcome !== "no") throw new Error("Bad outcome");
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (m.kind === "group" || m.status !== "live") throw new Error("Not resolvable");
      const closed = !!m.closesAt && m.closesAt <= new Date();
      if (!closed && !isAdmin(u) && m.creatorId !== u.id) throw new Error("Market hasn't closed yet");
      // Only a *changed* proposal resets the tally — re-submitting the same
      // outcome must not wipe dispute votes, or the dispute gate is void.
      if (m.proposedOutcome !== input.outcome)
        await tx.delete(schema.resolutionVote).where(eq(schema.resolutionVote.marketId, m.id));
      await tx
        .update(schema.market)
        .set({
          proposedOutcome: input.outcome,
          proposedById: u.id,
          proposedAt: new Date(),
          resolutionReason: (input.reason ?? "").trim().slice(0, 500),
        })
        .where(eq(schema.market.id, m.id));
    });
    revalidatePath("/");
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Proposal failed" };
  }
}

export async function voteResolution(input: {
  marketId: string;
  vote: "confirm" | "dispute";
}): Promise<{ ok: boolean; error?: string; resolved?: boolean }> {
  try {
    const u = await requireUser();
    if (input.vote !== "confirm" && input.vote !== "dispute") throw new Error("Bad vote");
    let resolved = false;
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (m.status !== "live" || !m.proposedOutcome) throw new Error("No active proposal");
      if (m.proposedById === u.id) throw new Error("You proposed this outcome");
      await tx
        .insert(schema.resolutionVote)
        .values({ marketId: m.id, userId: u.id, vote: input.vote })
        .onConflictDoUpdate({
          target: [schema.resolutionVote.marketId, schema.resolutionVote.userId],
          set: { vote: input.vote },
        });
      const [c] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.resolutionVote)
        .where(
          and(
            eq(schema.resolutionVote.marketId, m.id),
            eq(schema.resolutionVote.vote, "confirm")
          )
        );
      const [d] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.resolutionVote)
        .where(
          and(
            eq(schema.resolutionVote.marketId, m.id),
            eq(schema.resolutionVote.vote, "dispute")
          )
        );
      // Two confirms with no disputes settles the market at the proposal —
      // unless the community left enough notes to force an admin's eyes.
      const [nc] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.communityNote)
        .where(eq(schema.communityNote.marketId, m.id));
      if ((c?.n ?? 0) >= 2 && (d?.n ?? 0) === 0 && (nc?.n ?? 0) <= NOTE_ADMIN_GATE) {
        await settleMarketTx(tx, m, m.proposedOutcome === "no" ? "no" : "yes", m.resolutionReason);
        resolved = true;
      }
    });
    revalidatePath("/");
    revalidatePath("/admin");
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    return { ok: true, resolved };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Vote failed" };
  }
}

// Hard-delete a market and everything attached (group parents take their
// options with them via cascade). Admins can delete anything — holders are
// refunded at the current mark first, so nobody loses Marks to a deletion.
// Creators may delete only their own market while nobody has bet on it.
export async function deleteMarket(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const slug = await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      const targets = await tx
        .select()
        .from(schema.market)
        .where(sql`${schema.market.id} = ${m.id} OR ${schema.market.parentId} = ${m.id}`)
        .for("update");
      const ids = targets.map((x) => x.id);
      const [bets] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.trade)
        .where(sql`${schema.trade.marketId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);

      const admin = isAdmin(u);
      if (!admin) {
        if (m.creatorId !== u.id) throw new Error("Only the creator can delete this market");
        if ((bets?.n ?? 0) > 0) throw new Error("Cannot delete — bets were already placed");
      } else {
        // Admin nuke: refund open positions at mark before wiping. Options
        // price off their group's shared book — softmax over live siblings.
        const parentIds = [...new Set(targets.map((t) => t.parentId).filter((x): x is string => !!x))];
        const sibRows = parentIds.length
          ? await tx
              .select()
              .from(schema.market)
              .where(and(inArray(schema.market.parentId, parentIds), eq(schema.market.status, "live")))
          : [];
        const marks = new Map<string, number>();
        for (const pid of parentIds) {
          const group = sibRows.filter((s) => s.parentId === pid);
          if (!group.length) continue;
          const ps = multiPrices(
            multiCoords(group.map((s) => ({ qYes: toNum(s.qYes), qNo: toNum(s.qNo) }))),
            group[0].b
          );
          group.forEach((s, i) => marks.set(s.id, ps[i]));
        }
        for (const t of targets) {
          const py = t.parentId ? marks.get(t.id) ?? marketYesPrice(t) : marketYesPrice(t);
          const positions = await tx
            .select()
            .from(schema.position)
            .where(eq(schema.position.marketId, t.id))
            .for("update");
          for (const p of positions) {
            const refund = Math.max(0, Math.round((toNum(p.yesShares) * py + toNum(p.noShares) * (1 - py)) * 100) - p.debtCents);
            if (refund > 0) {
              await lockUser(tx, p.userId);
              await credit(tx, p.userId, refund, "refund", t.id, `Removed: ${t.question.slice(0, 60)}`);
            }
          }
        }
      }
      // Deleting the parent cascades children; for singles it's just the row.
      await tx.delete(schema.market).where(eq(schema.market.id, m.id));
      // An option row leaving the group can empty it — roll the parent up so
      // it doesn't sit "live" with nothing left to trade.
      await syncGroupStatus(tx, m);
      return m.slug;
    });
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath(`/market/${slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

// Admin-only: create a user account directly (username + password). The
// welcome-bonus ledger entry is inserted manually because direct inserts skip
// the Better Auth database hooks.
export async function adminCreateUser(input: {
  username: string;
  password: string;
  role?: "user" | "admin";
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const { hashPassword } = await import("better-auth/crypto");
    const username = input.username.trim().toLowerCase();
    if (username.length < 3) throw new Error("Username too short (min 3)");
    if (!/^[a-z0-9_.-]+$/.test(username)) throw new Error("Username: letters, digits, _ . - only");
    if (input.password.length < 6) throw new Error("Password too short (min 6)");
    const role = input.role === "admin" ? "admin" : "user";

    await db.transaction(async (tx) => {
      const dupe = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(sql`lower(${schema.user.username}) = ${username}`)
        .limit(1);
      if (dupe.length) throw new Error("Username taken");
      const id = crypto.randomUUID();
      const email = `${username}@monobet.local`;
      await tx.insert(schema.user).values({
        id,
        name: username,
        email,
        username,
        displayUsername: username,
        role,
      });
      await tx.insert(schema.account).values({
        id: crypto.randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: await hashPassword(input.password),
      });
      await tx.insert(schema.ledger).values({
        userId: id,
        amountCents: 100_000,
        balanceAfterCents: 100_000,
        kind: "signup",
        memo: "Welcome bonus",
      });
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create user failed" };
  }
}

// ---------- admin: user management ----------

// Target must exist and can't be the acting admin or the owner account.
async function assertManageableUser(userId: string, adminId: string) {
  if (userId === adminId) throw new Error("Can't modify your own account here");
  const [target] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!target) throw new Error("User not found");
  if ((target.email ?? "").toLowerCase() === SUPER_ADMIN_EMAIL) throw new Error("The owner account can't be modified");
}

export async function adminSetUserBanned(input: {
  userId: string;
  banned: boolean;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await assertManageableUser(input.userId, admin.id);
    await db.transaction(async (tx) => {
      await tx
        .update(schema.user)
        .set({
          bannedAt: input.banned ? new Date() : null,
          banReason: input.banned ? (input.reason ?? "").trim().slice(0, 200) || null : null,
        })
        .where(eq(schema.user.id, input.userId));
      // Drop live sessions so the ban bites immediately.
      if (input.banned) await tx.delete(schema.session).where(eq(schema.session.userId, input.userId));
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function adminSetCommentsBanned(input: {
  userId: string;
  banned: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await assertManageableUser(input.userId, admin.id);
    await db.update(schema.user).set({ commentsBanned: input.banned }).where(eq(schema.user.id, input.userId));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function adminSetUserRole(input: {
  userId: string;
  role: "user" | "admin";
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    if (input.role !== "user" && input.role !== "admin") throw new Error("Bad role");
    await assertManageableUser(input.userId, admin.id);
    await db.update(schema.user).set({ role: input.role }).where(eq(schema.user.id, input.userId));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

// Rename a user's handle — updates both the normalized `username` and the
// display casing. The owner may rename anyone, including themselves (the
// handle isn't security-sensitive like a ban).
export async function adminRenameUser(input: {
  userId: string;
  username: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    const display = input.username.trim().replace(/^@/, "");
    const normalized = display.toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized))
      throw new Error("Username: 2–32 chars, letters/numbers/_/-, no leading - or _");
    const [exists] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, input.userId))
      .limit(1);
    if (!exists) throw new Error("User not found");
    const isSelf = input.userId === admin.id;
    if (!isSelf) await assertManageableUser(input.userId, admin.id);
    const [dupe] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(sql`lower(${schema.user.username}) = ${normalized}`, sql`${schema.user.id} <> ${input.userId}`))
      .limit(1);
    if (dupe) throw new Error(`@${normalized} is taken`);
    await db
      .update(schema.user)
      .set({ username: normalized, displayUsername: display, updatedAt: new Date() })
      .where(eq(schema.user.id, input.userId));
    revalidatePath("/admin");
    revalidatePath(`/u/${normalized}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rename failed" };
  }
}

// Sets a brand-new password and drops existing sessions, so the user logs in
// with the new credentials next. Works even if the account somehow has no
// credential row yet.
export async function adminResetUserPassword(input: {
  userId: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    if (input.password.length < 6) throw new Error("Password too short (min 6)");
    await assertManageableUser(input.userId, admin.id);
    const { hashPassword } = await import("better-auth/crypto");
    const hash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      const [acc] = await tx
        .select({ id: schema.account.id })
        .from(schema.account)
        .where(and(eq(schema.account.userId, input.userId), eq(schema.account.providerId, "credential")))
        .limit(1);
      if (acc) {
        await tx.update(schema.account).set({ password: hash, updatedAt: new Date() }).where(eq(schema.account.id, acc.id));
      } else {
        await tx.insert(schema.account).values({
          id: crypto.randomUUID(),
          accountId: input.userId,
          providerId: "credential",
          userId: input.userId,
          password: hash,
        });
      }
      await tx.delete(schema.session).where(eq(schema.session.userId, input.userId));
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reset failed" };
  }
}

// Permanently delete a user — FK cascades wipe sessions, positions, trades,
// comments, votes, invites, duels and rewards; their markets stay (creatorId
// goes null). Same protections as banning: not self, not the owner account.
export async function adminDeleteUser(input: { userId: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await assertManageableUser(input.userId, admin.id);
    const [target] = await db
      .select({ role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, input.userId))
      .limit(1);
    if (target?.role === "admin") throw new Error("Remove the admin role first");
    await db.delete(schema.user).where(eq(schema.user.id, input.userId));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

// ---------- community notes ----------

// Above this many notes on one market, only a site admin may resolve it —
// the community flagged it loud enough that creator-resolution isn't trusted.
const NOTE_ADMIN_GATE = 5;

// True when `u` may moderate notes on market `m`: site admin, the market's
// creator, or — for a group option — the parent market's creator.
async function canModerateMarket(m: { creatorId: string | null; parentId: string | null }, userId: string, admin: boolean) {
  if (admin) return true;
  if (m.creatorId === userId) return true;
  if (m.parentId) {
    const [p] = await db.select({ creatorId: schema.market.creatorId }).from(schema.market).where(eq(schema.market.id, m.parentId)).limit(1);
    if (p?.creatorId === userId) return true;
  }
  return false;
}

// Add a note to a resolvable market — binary or a group option. Stance is the
// outcome the note argues for; resolver sees these before settling.
export async function addCommunityNote(input: {
  marketId: string;
  body: string;
  stance?: "yes" | "no";
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (u.commentsBanned) throw new Error("You're muted");
    await assertNotSpam(u.id, "comment");
    const body = input.body.trim().slice(0, 500);
    if (body.length < 10) throw new Error("Note too short — explain the reasoning");
    const m = await db.select().from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (!m[0] || m[0].kind === "group" || !["live", "resolved"].includes(m[0].status)) throw new Error("Not a resolvable market");
    await db.insert(schema.communityNote).values({
      marketId: m[0].id,
      userId: u.id,
      body,
      stance: input.stance === "no" ? "no" : input.stance === "yes" ? "yes" : null,
    });
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, m[0].id)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    if (m[0].parentId) {
      const [p] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, m[0].parentId)).limit(1);
      if (p) revalidatePath(`/market/${p.slug}`);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Note failed" };
  }
}

// Publish/unpublish a note onto the market page — resolver-only.
export async function setNotePublished(input: { noteId: string; published: boolean }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const [note] = await db.select().from(schema.communityNote).where(eq(schema.communityNote.id, input.noteId)).limit(1);
    if (!note) throw new Error("Note not found");
    const [m] = await db.select().from(schema.market).where(eq(schema.market.id, note.marketId)).limit(1);
    if (!m || !(await canModerateMarket(m, u.id, isAdmin(u)))) throw new Error("Only the resolver can publish notes");
    await db.update(schema.communityNote).set({ published: input.published }).where(eq(schema.communityNote.id, note.id));
    const [self] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, m.id)).limit(1);
    if (self) revalidatePath(`/market/${self.slug}`);
    if (m.parentId) {
      const [p] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, m.parentId)).limit(1);
      if (p) revalidatePath(`/market/${p.slug}`);
    }
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

// Delete a note — the author, or the resolver moderating their market.
export async function deleteCommunityNote(input: { noteId: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const [note] = await db.select().from(schema.communityNote).where(eq(schema.communityNote.id, input.noteId)).limit(1);
    if (!note) throw new Error("Note not found");
    if (note.userId !== u.id) {
      const [m] = await db.select().from(schema.market).where(eq(schema.market.id, note.marketId)).limit(1);
      if (!m || !(await canModerateMarket(m, u.id, isAdmin(u)))) throw new Error("Not your note");
    }
    await db.delete(schema.communityNote).where(eq(schema.communityNote.id, note.id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

// ---------- loans ----------
// Take a house loan: cash lands immediately, debt accrues at an APR rolled
// at borrow time — you gamble on the rate you get. Repay pays debt down
// out of balance; every touch accrues first so the figure is honest.

// Loan offers are a pick-a-card gamble: the server deals three hidden APRs
// into an HMAC-signed token (same scheme as the timer rounds); the borrower
// picks a card and owes whatever rate it hid. Existing debt blocks new loans
// — repay before borrowing again.
const LOAN_SECRET = process.env.BETTER_AUTH_SECRET ?? "monobet-dev-secret";

function signLoanOffers(userId: string, amountCents: number, rates: number[]): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, a: amountCents, r: rates, i: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", LOAN_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function openLoanOffers(token: string, userId: string): { a: number; r: number[] } {
  const [payload, sig] = token.split(".");
  const good = createHmac("sha256", LOAN_SECRET).update(payload ?? "").digest("base64url");
  if (!sig || sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good)))
    throw new Error("Bad offer");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; a: number; r: number[]; i: number };
  if (data.u !== userId) throw new Error("Not your offer");
  if (Date.now() - data.i > LOAN_OFFER_TTL_MS) throw new Error("Offers expired — deal again");
  if (!Array.isArray(data.r) || data.r.length !== LOAN_OFFER_COUNT) throw new Error("Bad offer");
  return { a: data.a, r: data.r };
}

async function assertNoDebt(userId: string) {
  const [u] = await db
    .select({ debtCents: schema.user.debtCents, debtRateBps: schema.user.debtRateBps, debtSince: schema.user.debtSince })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (accruedDebtCents(u?.debtCents ?? 0, u?.debtRateBps ?? 0, u?.debtSince ?? null) > 0)
    throw new Error("Repay your debt first");
}

export async function dealLoanOffers(input: { amountCents: number }): Promise<{ ok: boolean; error?: string; token?: string }> {
  try {
    const u = await requireUser();
    const amount = Math.round(input.amountCents);
    if (!LOAN_PRESETS_CENTS.includes(amount)) throw new Error("Bad loan size");
    await assertNoDebt(u.id);
    const rates = Array.from({ length: LOAN_OFFER_COUNT }, () => rollRateBps());
    return { ok: true, token: signLoanOffers(u.id, amount, rates) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Deal failed" };
  }
}

export async function takeLoan(input: { token: string; pick: number }): Promise<{ ok: boolean; error?: string; rateBps?: number; offers?: number[] }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "loan");
    const { a: amount, r: offers } = openLoanOffers(input.token, u.id);
    const pick = Math.round(input.pick);
    if (pick < 0 || pick >= offers.length) throw new Error("Pick a card");
    const rate = offers[pick];
    await db.transaction(async (tx) => {
      // Re-check on the locked row — the offers were dealt while debt-free,
      // but a second loan or repay race could have landed in between.
      const cur = await lockUser(tx, u.id);
      if (accruedDebtCents(cur.debtCents, cur.debtRateBps, cur.debtSince) > 0)
        throw new Error("Repay your debt first");
      // The rolled APR books up front — borrow Ɱ1,000 at 23.8% and you owe
      // Ɱ1,238 the moment the cash lands, so a same-second repay still pays.
      const owed = Math.round(amount * (1 + rate / 10_000));
      await credit(tx, u.id, amount, "loan", null, `Loan @ ${(rate / 100).toFixed(1)}% APR`);
      await addDebt(tx, u.id, owed, rate, `Loan taken — ${(rate / 100).toFixed(1)}% APR, ${((owed - amount) / 100).toFixed(2)}Ɱ interest charged up front`);
    });
    revalidatePath("/rewards");
    revalidatePath("/portfolio");
    return { ok: true, rateBps: rate, offers };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Loan failed" };
  }
}

export async function repayLoan(input: { amountCents?: number }): Promise<{ ok: boolean; error?: string; paidCents?: number; leftCents?: number }> {
  try {
    const u = await requireUser();
    const out = await db.transaction(async (tx) => {
      const cur = await lockUser(tx, u.id);
      const now = new Date();
      const debt = accruedDebtCents(cur.debtCents, cur.debtRateBps, cur.debtSince, now);
      if (debt <= 0) throw new Error("No debt");
      const want = input.amountCents ? Math.round(input.amountCents) : debt;
      if (!Number.isFinite(want) || want <= 0) throw new Error("Bad amount");
      const pay = Math.min(want, debt, cur.balanceCents);
      if (pay <= 0) throw new Error("Insufficient balance");
      await credit(tx, u.id, -pay, "repay", null, "Loan repayment");
      const left = Math.max(0, debt - pay);
      await tx
        .update(schema.user)
        .set({ debtCents: left, debtRateBps: left > 0 ? cur.debtRateBps : 0, debtSince: left > 0 ? now : null })
        .where(eq(schema.user.id, u.id));
      return { paid: pay, left };
    });
    revalidatePath("/rewards");
    revalidatePath("/portfolio");
    return { ok: true, paidCents: out.paid, leftCents: out.left };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Repay failed" };
  }
}

// ---------- the Wall of Debts ----------
// A prayer burns a candle fee and clears a small random slice of debt — or
// nothing, when the wall stays silent. One prayer per 6h. The note is
// public; the wall remembers everyone.

export async function wallPray(input: { note?: string }): Promise<{
  ok: boolean;
  error?: string;
  silent?: boolean;
  miracle?: boolean;
  backfire?: boolean;
  blessed?: boolean;
  clearedCents?: number;
  feeCents?: number;
  debtCents?: number;
  nextAt?: number;
}> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "wall");
    const note = (input.note ?? "").trim().slice(0, 140);
    // Cheap pre-check so the client gets the real countdown, not a raw error.
    const preNext = u.wallPrayerAt ? u.wallPrayerAt.getTime() + WALL_COOLDOWN_MS : null;
    if (preNext && preNext > Date.now()) return { ok: false, error: "The wall is still listening", nextAt: preNext };
    const out = await db.transaction(async (tx) => {
      const cur = await lockUser(tx, u.id);
      const now = new Date();
      const debt = accruedDebtCents(cur.debtCents, cur.debtRateBps, cur.debtSince, now);
      if (debt <= 0) throw new Error("No debt to pray away");
      if (cur.wallPrayerAt && now.getTime() - cur.wallPrayerAt.getTime() < WALL_COOLDOWN_MS)
        throw new Error("The wall is still listening");
      const fee = Math.max(WALL_FEE_MIN_CENTS, Math.round(debt * WALL_FEE_DEBT_PCT));
      if (cur.balanceCents < fee) throw new Error(`The candle costs Ɱ ${(fee / 100).toFixed(2)}`);
      // The candle burns — the fee is gone regardless of what the wall answers.
      await credit(tx, u.id, -fee, "burn", null, "Wall candle");
      // A wordless slip is an insult, not a prayer — the wall keeps the fee
      // and answers with interest: the debt grows. Recorded as a negative
      // cleared amount so the wall remembers the insult.
      if (!note) {
        const penalty = Math.min(DEBT_CAP_CENTS - debt, Math.ceil(debt * WALL_BACKFIRE_PCT));
        const left = debt + penalty;
        await tx
          .update(schema.user)
          .set({ debtCents: left, debtRateBps: cur.debtRateBps, debtSince: now, wallPrayerAt: now })
          .where(eq(schema.user.id, u.id));
        await tx.insert(schema.wallPrayer).values({
          userId: u.id,
          note: "",
          feeCents: fee,
          clearedCents: -penalty,
          miracle: false,
        });
        return { cleared: -penalty, fee, left, silent: false, miracle: false, backfire: true, blessed: false, nextAt: now.getTime() + WALL_COOLDOWN_MS };
      }
      // Prayers naming the holy land move the stones more often.
      const blessed = WALL_BLESSED_RE.test(note);
      const silent = randomInt(100) < (blessed ? WALL_BLESSED_SILENT_PCT : WALL_SILENT_PCT);
      const miracle = !silent && randomInt(1000) < (blessed ? WALL_BLESSED_MIRACLE_PER_MILLE : WALL_MIRACLE_PER_MILLE);
      const clearMax = blessed ? WALL_BLESSED_CLEAR_MAX_PCT : WALL_CLEAR_MAX_PCT;
      const cleared = silent
        ? 0
        : miracle
          ? debt
          // sqrt skews the draw upward — bigger forgiveness is the likelier
          // answer; small slices still happen near the floor.
          : Math.round(debt * (WALL_CLEAR_MIN_PCT + Math.sqrt(randomInt(1000) / 1000) * (clearMax - WALL_CLEAR_MIN_PCT)));
      const left = Math.max(0, debt - cleared);
      await tx
        .update(schema.user)
        .set({
          debtCents: left,
          debtRateBps: left > 0 ? cur.debtRateBps : 0,
          debtSince: left > 0 ? now : null,
          wallPrayerAt: now,
        })
        .where(eq(schema.user.id, u.id));
      await tx.insert(schema.wallPrayer).values({
        userId: u.id,
        note,
        feeCents: fee,
        clearedCents: cleared,
        miracle,
      });
      // A full absolution deserves a bell — it clears the whole debt.
      if (miracle)
        await ping(tx, u.id, `The wall answered — all debt forgiven (${(debt / 100).toFixed(2)}Ɱ cleared)`);
      return { cleared, fee, left, silent, miracle, backfire: false, blessed, nextAt: now.getTime() + WALL_COOLDOWN_MS };
    });
    revalidatePath("/rewards");
    revalidatePath("/portfolio");
    return { ok: true, silent: out.silent, miracle: out.miracle, backfire: out.backfire, blessed: out.blessed, clearedCents: out.cleared, feeCents: out.fee, debtCents: out.left, nextAt: out.nextAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The wall didn't answer" };
  }
}

// The vow — pledge a share of every win toward the debt until it's clear.
export async function setVow(input: { bps: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const bps = Math.round(input.bps);
    if (!VOW_CHOICES_BPS.includes(bps)) throw new Error("Bad vow");
    await db.update(schema.user).set({ vowBps: bps }).where(eq(schema.user.id, u.id));
    revalidatePath("/rewards");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Vow failed" };
  }
}

export async function cancelMarket(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, marketId);
      if (!isAdmin(u) && m.creatorId !== u.id) throw new Error("Only the creator or an admin can cancel");
      if (m.kind === "group") throw new Error("Cancel the group's options instead");
      if (m.status === "resolved" || m.status === "cancelled") throw new Error("Already closed");
      const py = await optionMarkPrice(tx, m);
      const positions = await tx
        .select()
        .from(schema.position)
        .where(eq(schema.position.marketId, marketId))
        .for("update");
      for (const p of positions) {
        const refund = Math.max(0, Math.round((toNum(p.yesShares) * py + toNum(p.noShares) * (1 - py)) * 100) - p.debtCents);
        await lockUser(tx, p.userId);
        if (refund > 0) {
          await credit(tx, p.userId, refund, "refund", m.id, `Refund: ${m.question.slice(0, 60)}`);
        } else {
          // No refund due — still tell the holder their position is gone.
          await ping(tx, p.userId, `Cancelled — position closed with no refund: ${m.question.slice(0, 60)}`, m.id);
        }
      }
      await tx.delete(schema.position).where(eq(schema.position.marketId, marketId));
      await tx.update(schema.market).set({
        status: "cancelled",
        resolvedAt: new Date(),
        proposedOutcome: null,
        proposedById: null,
        proposedAt: null,
      }).where(eq(schema.market.id, marketId));
      await tx.delete(schema.resolutionVote).where(eq(schema.resolutionVote.marketId, marketId));
      await syncGroupStatus(tx, m);
      if (m.parentId) {
        // The cancelled option leaves the book — the survivors' probabilities
        // renormalize, so give each a fresh history point.
        const sibs = await tx
          .select()
          .from(schema.market)
          .where(and(eq(schema.market.parentId, m.parentId), eq(schema.market.status, "live")))
          .orderBy(asc(schema.market.id));
        const prices = multiPrices(
          multiCoords(sibs.map((s) => ({ qYes: toNum(s.qYes), qNo: toNum(s.qNo) }))),
          m.b
        );
        for (const [j, s] of sibs.entries()) {
          await tx.insert(schema.pricePoint).values({ marketId: s.id, yesPrice: prices[j].toFixed(5) });
        }
      }
      revalidatePath(`/market/${m.slug}`);
    });
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Cancel failed" };
  }
}

// ---------- comments ----------

export async function addComment(input: {
  marketId: string;
  body: string;
  image?: string | null;
  parentId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (u.commentsBanned) throw new Error("Comments are disabled for your account");
    if (u.commentBanUntil && u.commentBanUntil > new Date())
      throw new Error("You are timed out from commenting");
    await assertNotSpam(u.id, "comment");
    const body = input.body.trim();
    if (!body) throw new Error("Empty comment");
    if (body.length > 1000) throw new Error("Comment too long (max 1000)");
    const image = input.image ?? null;
    if (image) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new Error("Bad image format");
      if (image.length > 450_000) throw new Error("Image too large");
    }
    // Replies hang one level deep — the parent must be a top-level comment on
    // this market, never another reply.
    let parentId: string | null = null;
    if (input.parentId) {
      const [p] = await db
        .select({ marketId: schema.comment.marketId, parentId: schema.comment.parentId })
        .from(schema.comment)
        .where(eq(schema.comment.id, input.parentId))
        .limit(1);
      if (!p || p.marketId !== input.marketId || p.parentId) throw new Error("Bad parent");
      parentId = input.parentId;
    }
    await db.insert(schema.comment).values({ marketId: input.marketId, userId: u.id, body, imageUrl: image, parentId });
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Comment failed" };
  }
}

export async function editComment(input: {
  commentId: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (u.commentsBanned) throw new Error("Comments are disabled for your account");
    if (u.commentBanUntil && u.commentBanUntil > new Date())
      throw new Error("You are timed out from commenting");
    const body = input.body.trim();
    if (!body) throw new Error("Empty comment");
    if (body.length > 1000) throw new Error("Comment too long (max 1000)");
    const [c] = await db.select().from(schema.comment).where(eq(schema.comment.id, input.commentId)).limit(1);
    if (!c) throw new Error("Not found");
    if (c.userId !== u.id) throw new Error("Not yours");
    if (c.hidden) throw new Error("Hidden comments can't be edited");
    await db.update(schema.comment).set({ body }).where(eq(schema.comment.id, c.id));
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Edit failed" };
  }
}

// Admin comment tools: censor keeps the row but masks the body; timeout mutes
// the author for N hours; commentsBanned is the permanent variant.
export async function adminSetCommentHidden(input: {
  commentId: string;
  hidden: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const [c] = await db.select().from(schema.comment).where(eq(schema.comment.id, input.commentId)).limit(1);
    if (!c) throw new Error("Not found");
    await db.update(schema.comment).set({ hidden: input.hidden }).where(eq(schema.comment.id, c.id));
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function adminTimeoutComments(input: {
  userId: string;
  hours: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();
    await assertManageableUser(input.userId, admin.id);
    const hours = Math.min(Math.max(Math.round(input.hours), 1), 24 * 30);
    const until = hours > 0 ? new Date(Date.now() + hours * 3600_000) : null;
    await db.update(schema.user).set({ commentBanUntil: until }).where(eq(schema.user.id, input.userId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

// Autocomplete for squad invites — only squad-less users can be invited.
export async function searchUsers(q: string): Promise<{ username: string | null; name: string; image: string | null }[]> {
  const u = await requireUser();
  const term = q.trim().replace(/^@/, "");
  return db
    .select({ username: schema.user.username, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(
      and(
        term ? sql`lower(${schema.user.username}) like lower(${"%" + term.replace(/[%_]/g, "") + "%"})` : undefined,
        isNull(schema.user.squadId),
        sql`${schema.user.id} <> ${u.id}`
      )
    )
    .orderBy(asc(schema.user.username))
    .limit(12);
}

export async function deleteComment(commentId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const [c] = await db.select().from(schema.comment).where(eq(schema.comment.id, commentId)).limit(1);
    if (!c) throw new Error("Not found");
    if (c.userId !== u.id && !isAdmin(u)) throw new Error("Not yours");
    await db.delete(schema.comment).where(eq(schema.comment.id, commentId));
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

// value: 1 = like, -1 = dislike; sending the same value again removes the vote.
export async function voteComment(input: {
  commentId: string;
  value: 1 | -1;
}): Promise<{ ok: boolean; error?: string; myVote?: number }> {
  try {
    const u = await requireUser();
    if (input.value !== 1 && input.value !== -1) throw new Error("Bad vote");
    const [c] = await db.select().from(schema.comment).where(eq(schema.comment.id, input.commentId)).limit(1);
    if (!c) throw new Error("Not found");

    let myVote: number = input.value;
    await db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ value: schema.commentVote.value })
        .from(schema.commentVote)
        .where(and(eq(schema.commentVote.commentId, input.commentId), eq(schema.commentVote.userId, u.id)))
        .for("update")
        .limit(1);
      if (cur?.value === input.value) {
        myVote = 0;
        await tx
          .delete(schema.commentVote)
          .where(and(eq(schema.commentVote.commentId, input.commentId), eq(schema.commentVote.userId, u.id)));
      } else {
        await tx
          .insert(schema.commentVote)
          .values({ commentId: input.commentId, userId: u.id, value: input.value })
          .onConflictDoUpdate({
            target: [schema.commentVote.commentId, schema.commentVote.userId],
            set: { value: input.value },
          });
      }
    });
    const [m] = await db.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
    if (m) revalidatePath(`/market/${m.slug}`);
    return { ok: true, myVote };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Vote failed" };
  }
}



// ---------- minigames ----------

const MIN_BET_CENTS = 100; // Ɱ1
const RIG_PCT = 35; // rigged dealers flip ~⅓ of player wins

// Leverage on games is real margin (eToro-style): the stake is collateral,
// the rest of the notional is borrowed from the house at stake time — a win
// pays stake + (mult-1) × notional and releases the borrowing, a loss keeps
// it as interest-bearing debt. The levered top-up also costs a one-off
// funding fee, charged up front. Abandoning a leveraged round keeps the
// debt — folding a position doesn't erase the exposure.
// Stake + funding fee against the locked row. Split out of settleGame so the
// timer can charge at round start — an abandoned round forfeits the wager
// instead of refunding by silence.
async function stakeGame(tx: Tx, userId: string, betCents: number, leverage: number, label: string, game: GameKey): Promise<number> {
  const wager = Math.round(betCents * leverage);
  if (wager > MAX_GAME_WAGER_CENTS) throw new Error("Bet too large");
  // Kill-switch + leverage/stake knobs ride the same config row.
  const [cfg] = await tx
    .select({ d: schema.casinoConfig.disabledGames, gMax: schema.casinoConfig.gameMaxLev, per: schema.casinoConfig.gameLevCaps, feeBps: schema.casinoConfig.levFeeBps, gBet: schema.casinoConfig.gameMaxBetCents, betCaps: schema.casinoConfig.gameBetCaps, flatFee: schema.casinoConfig.gameFeeCents, dailyMs: schema.casinoConfig.gameDailyLimitMs, idleMs: schema.casinoConfig.gameIdleMs, debtRate: schema.casinoConfig.debtRateBps })
    .from(schema.casinoConfig)
    .where(eq(schema.casinoConfig.id, "house"));
  if (cfg?.d?.includes(game)) throw new Error("This game is temporarily disabled");
  const cap = gameLevCap(cfg ? { gameMaxLev: cfg.gMax, gameLevCaps: cfg.per } : undefined, game);
  if (leverage > cap) throw new Error(`Max leverage here is ${cap}×`);
  const betCap = gameBetCap(cfg ? { gameMaxBetCents: cfg.gBet, gameBetCaps: cfg.betCaps } : undefined, game);
  if (betCents > betCap) throw new Error(`Max bet here is Ɱ ${(betCap / 100).toFixed(0)}`);
  const fee = levFeeCents(betCents, leverage, cfg?.feeBps ?? LEV_FEE_BPS);
  const flatFee = cfg?.flatFee ?? GAME_FEE_CENTS;
  const dailyLimitMs = cfg?.dailyMs ?? GAME_DAILY_LIMIT_MS;
  const idleMs = cfg?.idleMs ?? GAME_IDLE_MS;
  const debtRate = cfg?.debtRate ?? GAME_DEBT_RATE_BPS;
  // Credit check + charge both run on the locked row — the pre-tx snapshot
  // could be a debt repayment stale.
  const u = await lockUser(tx, userId);
  // Auto-repay: an active debtor's spare balance feeds the loan before the
  // new stake is priced, so the wager math sees the post-repay balance.
  if (u.autoRepay) await sweepDebt(tx, u);
  // Daily cap — every game debits through stakeGame, so this is the one gate:
  // admin-set hours of in-game time per user per 24h window. The window
  // anchors at the first stake (not midnight); time accrues stake-to-stake
  // while the player keeps playing, and an idleMs gap closes the clock so
  // idle time is free. In-flight rounds (hit/stand/double, timer stop) never
  // call this, so a hand or timer round always settles even as the budget
  // runs out.
  const now = Date.now();
  let ws = u.gameSessionStart?.getTime() ?? null;
  const lp = u.gameLastPlayAt?.getTime() ?? null;
  let played = u.gamePlayedMs ?? 0;
  if (ws === null || now - ws >= GAME_WINDOW_MS) {
    ws = now;
    played = 0;
  } else if (lp !== null && now - lp < idleMs) {
    played += now - lp;
  }
  if (played >= dailyLimitMs) {
    const hrs = dailyLimitMs / 3_600_000;
    throw new Error(`Minigames capped at ${hrs % 1 ? hrs.toFixed(1) : hrs}h per day — back in ${Math.ceil((ws + GAME_WINDOW_MS - now) / 60000)}m`);
  }
  await tx
    .update(schema.user)
    .set({ gameSessionStart: new Date(ws), gameLastPlayAt: new Date(now), gamePlayedMs: played })
    .where(eq(schema.user.id, u.id));
  assertCreditLine(u, leverage);
  await credit(tx, userId, -betCents, "game", null, `${label} — wager ×${leverage}`);
  // Fees ride their own "fee" ledger rows — the flat round fee and the
  // leverage funding fee separately — so admin reports them apart from
  // wager swings and can split funding from flat charges.
  await credit(tx, userId, -flatFee, "fee", null, `${label} — round fee`);
  if (fee > 0) await credit(tx, userId, -fee, "fee", null, `${label} — leverage fee Ɱ${(fee / 100).toFixed(2)}`);
  // The borrowed notional is real margin debt from the moment it stakes —
  // a win releases it at settle, a loss (or an abandoned round) keeps it.
  const borrowed = betCents * (leverage - 1);
  if (borrowed > 0) await addDebt(tx, userId, borrowed, debtRate, `${label} — leveraged Ɱ${(borrowed / 100).toFixed(2)} margin`);
  return fee + flatFee;
}

// prepaidFeeCents: callers that staked at round-start pass the stored fee so
// the settle books identically to what was debited (admin can retune the
// funding rate between start and stop without drifting the round's books).
async function settleGame(
  tx: Tx,
  userId: string,
  betCents: number,
  leverage: number,
  won: boolean,
  mult: number,
  label: string,
  dealer: Persona | undefined,
  prepaidFeeCents: number | undefined,
  game: GameKey
): Promise<{ netCents: number; feeCents: number; skimCents: number; tavCents: number }> {
  const wager = Math.round(betCents * leverage);
  if (wager > MAX_GAME_WAGER_CENTS) throw new Error("Bet too large");
  const fee = prepaidFeeCents !== undefined ? prepaidFeeCents : await stakeGame(tx, userId, betCents, leverage, label, game);
  const borrowed = betCents * (leverage - 1);
  let win = 0;
  let skim = 0;
  let tav = 0;
  // Raw return can go negative on leveraged sub-1x rounds — that unpaid part
  // of the borrowed notional stays on the books as debt.
  const rawWin = won ? levWinRawCents(betCents, leverage, mult) : betCents - wager;
  win = Math.max(0, rawWin);
  const owed = Math.max(0, -rawWin); // portion of the margin the round can't repay
  // Release the margin this settlement repays BEFORE garnishing the win —
  // otherwise a vowing player's own round-margin would eat their profit and
  // then get released anyway (double-counted).
  const release = borrowed - owed;
  if (release > 0) await releaseDebt(tx, userId, release, `${label} — leverage repaid Ɱ${(release / 100).toFixed(2)}`);
  if (won) {
    // A debtor's win pays the house debt first — the profit garnishes it.
    skim = Math.min(win, await garnishDebt(tx, userId, win - betCents, label));
    const take = win - skim;
    // Sub-1x segments refund part of the stake — the ledger says so plainly;
    // an exact refund reads "push".
    if (take > 0) await credit(tx, userId, take, "game", null, `${label} — ${win > betCents ? "won" : win === betCents ? "push" : "partial return"} ×${mult}${skim ? " (debt repaid)" : ""}`);
    if (dealer && dealerFx(dealer).blessed) tav = await telAvivBonus(tx, userId);
  }
  return { netCents: win - skim - betCents - fee - owed, feeCents: fee, skimCents: skim, tavCents: tav };
}

// Tel Aviv bonus — a win under Bibi forgives 6.7% of accrued house debt, at
// most once every 12h. The last "tav" ledger row is the clock; the check and
// the write share the caller's transaction on the already-locked user row,
// so concurrent wins can't double-claim.
async function telAvivBonus(tx: Tx, userId: string): Promise<number> {
  const u = await lockUser(tx, userId);
  const debt = accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince);
  if (debt <= 0) return 0;
  const [last] = await tx
    .select({ at: schema.ledger.createdAt })
    .from(schema.ledger)
    .where(and(eq(schema.ledger.userId, userId), eq(schema.ledger.kind, "tav")))
    .orderBy(sql`${schema.ledger.createdAt} desc`)
    .limit(1);
  if (last && Date.now() - new Date(last.at).getTime() < TAV_COOLDOWN_MS) return 0;
  const forgive = Math.min(debt, Math.ceil(debt * TAV_BONUS_PCT));
  if (forgive <= 0) return 0;
  const left = debt - forgive;
  await tx
    .update(schema.user)
    .set({ debtCents: left, debtRateBps: left > 0 ? u.debtRateBps : 0, debtSince: left > 0 ? new Date() : null })
    .where(eq(schema.user.id, userId));
  await tx.insert(schema.ledger).values({
    userId,
    amountCents: 0,
    balanceAfterCents: u.balanceCents,
    kind: "tav",
    marketId: null,
    memo: `Tel Aviv bonus — ${(forgive / 100).toFixed(2)}Ɱ of the loan forgiven`,
  });
  await ping(tx, userId, `Tel Aviv bonus — ${(forgive / 100).toFixed(2)}Ɱ of your loan forgiven`);
  return forgive;
}

// Bibi's blessing — a losing round under his table flips to a win. The odds
// grow with prayers left at the Wall of Debts, counted server-side.
// Admin casino tuning — a single config row ("house"). rigBps flips that
// share of player wins into losses across the random games; a user's
// luckBps (negative = unlucky) applies after all dealer effects resolve.
async function casinoRigBps(): Promise<number> {
  const [row] = await db.select({ rigBps: schema.casinoConfig.rigBps }).from(schema.casinoConfig).where(eq(schema.casinoConfig.id, "house"));
  return row?.rigBps ?? 0;
}

// Player-luck roll: positive bps rescues a loss, negative spoils a win.
function luckRoll(won: boolean, luckBps: number): "win" | "lose" | null {
  if (!won && luckBps > 0 && randomInt(10_000) < luckBps) return "win";
  if (won && luckBps < 0 && randomInt(10_000) < -luckBps) return "lose";
  return null;
}

async function maybeBless(userId: string, dealer: Persona): Promise<boolean> {
  if (!dealerFx(dealer).blessed) return false;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.wallPrayer)
    .where(eq(schema.wallPrayer.userId, userId));
  return randomInt(100) < blessedChancePct(r?.n ?? 0);
}



function checkBet(betCents: number, leverage: number) {
  const bet = Math.round(betCents);
  const lev = Math.round(leverage);
  if (!Number.isFinite(bet) || bet < MIN_BET_CENTS) throw new Error("Minimum bet is Ɱ 1");
  // Stake ceiling lives in stakeGame — it reads the admin-configured cap
  // (game_max_bet_cents / game_bet_caps), which this cheap pre-check can't see.
  if (bet > MAX_GAME_WAGER_CENTS) throw new Error("Bet too large");
  if (!GAME_LEVERAGES.includes(lev as (typeof GAME_LEVERAGES)[number])) throw new Error("Bad leverage");
  return { bet, lev };
}

// The house won't extend credit to a debtor — leverage locks until the debt
// (with accrued interest) is repaid. Applies to games and leveraged trades.
function assertCreditLine(u: { debtCents: number; debtRateBps: number; debtSince: Date | null }, lev: number) {
  if (lev > 1 && accruedDebtCents(u.debtCents, u.debtRateBps, u.debtSince) > 0)
    throw new Error("In debt — the house won't extend credit. Repay first.");
}

export async function playCoinFlip(input: {
  betCents: number;
  leverage: number;
  pick: "heads" | "tails";
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; landed?: string; netCents?: number; dealer?: Persona; feeCents?: number; skimCents?: number; tavCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    if (input.pick !== "heads" && input.pick !== "tails") throw new Error("Pick a side");
    let landed: "heads" | "tails" = randomInt(2) === 0 ? "heads" : "tails";
    let won = landed === input.pick;
    const dealer = await pickDealer(input.dealerId);
    // Rigged table: a share of player wins quietly flips the other way.
    if (dealerFx(dealer).rigged && won && randomInt(100) < RIG_PCT) {
      landed = landed === "heads" ? "tails" : "heads";
      won = false;
    }
    // Blessed table: prayers at the Wall flip a share of losses back.
    if (!won && (await maybeBless(u.id, dealer))) {
      landed = input.pick;
      won = true;
    }
    // House tuning: admin rig spoils wins, per-user luck rescues (or spoils).
    if (won && randomInt(10_000) < (await casinoRigBps())) {
      landed = landed === "heads" ? "tails" : "heads";
      won = false;
    }
    const luck = luckRoll(won, u.luckBps);
    if (luck === "win") {
      landed = input.pick;
      won = true;
    } else if (luck === "lose") {
      landed = landed === "heads" ? "tails" : "heads";
      won = false;
    }
    const { netCents, feeCents, skimCents, tavCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, COINFLIP_MULT, `Coin flip ${input.pick}→${landed}`, dealer, undefined, "coinflip")
    );
    revalidatePath("/games");
    return { ok: true, won, landed, netCents, dealer, feeCents, skimCents, tavCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Flip failed" };
  }
}

export async function playDice(input: {
  betCents: number;
  leverage: number;
  over: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; roll?: number; netCents?: number; dealer?: Persona; feeCents?: number; skimCents?: number; tavCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const over = Math.round(input.over);
    if (over < DICE_MIN_OVER || over > DICE_MAX_OVER) throw new Error("Bad target");
    let roll = randomInt(1, 7);
    let won = roll > over;
    const [diceCfg] = await db.select({ pay: schema.casinoConfig.dicePayBps }).from(schema.casinoConfig).where(eq(schema.casinoConfig.id, "house"));
    const mult = diceMult(over, (diceCfg?.pay ?? 9200) / 10_000);
    const dealer = await pickDealer(input.dealerId);
    if (dealerFx(dealer).rigged && won && randomInt(100) < RIG_PCT) {
      roll = randomInt(1, over); // a losing face, still inside 1..over
      won = false;
    }
    if (!won && (await maybeBless(u.id, dealer))) {
      roll = over + 1 + randomInt(6 - over); // a winning face, over+1..6
      won = true;
    }
    if (won && randomInt(10_000) < (await casinoRigBps())) {
      roll = randomInt(1, over);
      won = false;
    }
    const luck = luckRoll(won, u.luckBps);
    if (luck === "win") {
      roll = over + 1 + randomInt(6 - over);
      won = true;
    } else if (luck === "lose") {
      roll = randomInt(1, over);
      won = false;
    }
    const { netCents, feeCents, skimCents, tavCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, mult, `Dice >${over} → ${roll}`, dealer, undefined, "dice")
    );
    revalidatePath("/games");
    return { ok: true, won, roll, netCents, dealer, feeCents, skimCents, tavCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Roll failed" };
  }
}

// ---------- jobs ----------

export async function startJobShift(input: {
  job: string;
}): Promise<{ ok: boolean; error?: string; token?: string; problems?: MathProblem[] }> {
  const startedAt = Date.now();
  try {
    const u = await requireUser();
    if (!JOBS.includes(input.job as Job)) throw new Error("Bad job");
    const job = input.job as Job;
    const problems = job === "math" ? genMathProblems() : null;
    const token = await db.transaction(async (tx) => {
      await lockUser(tx, u.id);
      const [recent] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.jobShift)
        .where(and(eq(schema.jobShift.userId, u.id), gte(schema.jobShift.startedAt, new Date(startedAt - 3_000))));
      if ((recent?.n ?? 0) > 0) throw new Error("Too fast");
      const [shift] = await tx
        .insert(schema.jobShift)
        .values({ userId: u.id, job, payload: problems, startedAt: new Date(startedAt) })
        .returning({ id: schema.jobShift.id });
      return shift.id;
    });
    return { ok: true, token, ...(problems ? { problems } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Start failed" };
  }
}

export async function finishJobShift(input: {
  token: string;
  plates?: number;
  answers?: (number | null)[];
}): Promise<{ ok: boolean; error?: string; earnedCents?: number; grossCents?: number; capped?: boolean; correct?: number }> {
  const finishedAt = Date.now();
  try {
    const u = await requireUser();
    const result = await db.transaction(async (tx) => {
      const [shift] = await tx
        .update(schema.jobShift)
        .set({ settledAt: new Date(finishedAt) })
        .where(and(eq(schema.jobShift.id, input.token), eq(schema.jobShift.userId, u.id), isNull(schema.jobShift.settledAt)))
        .returning();
      if (!shift) throw new Error("Bad job token");
      await lockUser(tx, u.id);

      const elapsedMs = finishedAt - shift.startedAt.getTime();
      const problems = shift.payload ?? [];
      const answers = (Array.isArray(input.answers) ? input.answers : [])
        .slice(0, problems.length)
        .map((answer) => (typeof answer === "number" && Number.isFinite(answer) ? answer : null));
      const correct = shift.job === "math"
        ? problems.reduce((n, problem, i) => n + (answers[i] === mathAnswer(problem) ? 1 : 0), 0)
        : undefined;
      const grossCents =
        shift.job === "dishes"
          ? dishesPay(input.plates ?? 0, elapsedMs)
          : shift.job === "math"
            ? mathPay(problems, answers, elapsedMs)
            : 0;
      const [earned] = await tx
        .select({ cents: sql<number>`coalesce(sum(${schema.ledger.amountCents}), 0)::bigint` })
        .from(schema.ledger)
        .where(
          and(
            eq(schema.ledger.userId, u.id),
            eq(schema.ledger.kind, "job"),
            gte(schema.ledger.createdAt, new Date(finishedAt - 24 * 60 * 60_000))
          )
        );
      const earnedCents = capJobPay(grossCents, Number(earned?.cents ?? 0));
      await tx.update(schema.jobShift).set({ earnedCents }).where(eq(schema.jobShift.id, shift.id));
      if (earnedCents > 0) {
        const memo =
          shift.job === "dishes"
            ? `Brigáda: mytí nádobí · ${Math.floor(grossCents / DISH_PAY_CENTS)} talířů`
            : `Brigáda: doučování · ${correct ?? 0}/${problems.length}`;
        await credit(tx, u.id, earnedCents, "job", null, memo);
      }
      return { earnedCents, grossCents, capped: earnedCents < grossCents, correct };
    });
    revalidatePath("/jobs");
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Finish failed" };
  }
}

// Stop-the-timer rounds are rows, not tokens: start debits the stake up front
// (an abandoned round forfeits it — walking away is not free), and stop claims
// the row atomically so a round can only settle once. Elapsed is measured
// between the two action-entry timestamps on the app clock; the client-sent
// number is only the instant readout — never the score.
export async function startTimerRound(input: {
  targetMs: number;
  betCents: number;
  leverage: number;
}): Promise<{ ok: boolean; error?: string; token?: string }> {
  // Anchor the round the instant the request lands — the session lookup,
  // spam check, and stake transaction below can take hundreds of ms, and
  // all of it would otherwise count against the player's clock.
  const startedAt = Date.now();
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const target = Math.round(input.targetMs);
    if (!TIMER_TARGETS.includes(target as (typeof TIMER_TARGETS)[number])) throw new Error("Bad target");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const roundId = await db.transaction(async (tx) => {
      const fee = await stakeGame(tx, u.id, bet, lev, `Timer ${target / 1000}s`, "timer");
      const jitter = timerJitterRangeMs(target);
      const [r] = await tx
        .insert(schema.timerRound)
        .values({ userId: u.id, targetMs: target, jitterMs: randomInt(2 * jitter + 1) - jitter, betCents: bet, leverage: lev, feeCents: fee, startedAt: new Date(startedAt) })
        .returning({ id: schema.timerRound.id });
      return r.id;
    });
    return { ok: true, token: roundId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Start failed" };
  }
}

export async function stopTimerRound(input: {
  token: string;
  elapsedMs: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; elapsedMs?: number; errMs?: number; gradedMs?: number; netCents?: number; mult?: number; dealer?: Persona; feeCents?: number; skimCents?: number; tavCents?: number }> {
  // Capture the stop at arrival — requireUser/pickDealer and the claim
  // update below would otherwise append their own latency to the measured
  // elapsed, which the player perceives as "time gets added".
  const stoppedAt = Date.now();
  try {
    const u = await requireUser();
    const dealer = await pickDealer(input.dealerId);
    const out = await db.transaction(async (tx) => {
      // Claim first: settled_at IS NULL is the single-use gate — a replayed
      // or expired round id finds nothing to settle.
      const [round] = await tx
        .update(schema.timerRound)
        .set({ settledAt: new Date(stoppedAt) })
        .where(and(eq(schema.timerRound.id, input.token), eq(schema.timerRound.userId, u.id), isNull(schema.timerRound.settledAt)))
        .returning();
      if (!round) throw new Error("Bad round token");
      // Same app clock at both ends; pre-migration rows fall back to
      // created_at (Postgres clock — the old mixed-clock reading).
      const elapsed = stoppedAt - (round.startedAt ?? round.createdAt).getTime();
      const err = Math.abs(elapsed - (round.targetMs + round.jitterMs));
      let mult = timerMult(err, round.targetMs);
      let won = mult > 0;
      if (!won && (await maybeBless(u.id, dealer))) {
        mult = timerMult(0, round.targetMs); // blessed reads as a perfect stop
        won = true;
      }
      const s = await settleGame(tx, u.id, round.betCents, round.leverage, won, mult, `Timer ${round.targetMs / 1000}s off by ${err}ms`, dealer, round.feeCents, "timer");
      return { round, elapsed, err, won, mult, ...s };
    });
    revalidatePath("/games");
    return { ok: true, won: out.won, elapsedMs: out.elapsed, errMs: out.err, gradedMs: out.round.targetMs + out.round.jitterMs, netCents: out.netCents, mult: out.mult, dealer, feeCents: out.feeCents, skimCents: out.skimCents, tavCents: out.tavCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stop failed" };
  }
}

// Red or black — one card, one call. Instant settle like coinflip.
export async function playRedBlack(input: {
  betCents: number;
  leverage: number;
  pick: "red" | "black";
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; card?: number; netCents?: number; dealer?: Persona; feeCents?: number; skimCents?: number; tavCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    if (input.pick !== "red" && input.pick !== "black") throw new Error("Pick a color");
    const dealer = await pickDealer(input.dealerId);
    // Draws stay coherent with the outcome: a flip rerolls the opposite color.
    const draw = (red: boolean) => { let c = randomInt(52); while (cardIsRed(c) !== red) c = randomInt(52); return c; };
    let card = draw(randomInt(2) === 0); // first card, any color
    let won = cardIsRed(card) === (input.pick === "red");
    if (dealerFx(dealer).rigged && won && randomInt(100) < RIG_PCT) { card = draw(input.pick === "black"); won = false; }
    if (!won && (await maybeBless(u.id, dealer))) { card = draw(input.pick === "red"); won = true; }
    if (won && randomInt(10_000) < (await casinoRigBps())) { card = draw(input.pick === "black"); won = false; }
    const luck = luckRoll(won, u.luckBps);
    if (luck === "win") { card = draw(input.pick === "red"); won = true; }
    else if (luck === "lose") { card = draw(input.pick === "black"); won = false; }
    const landed = cardIsRed(card) ? "red" : "black";
    const s = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, REDBLACK_MULT, `Red/Black ${input.pick}→${landed}`, dealer, undefined, "redblack")
    );
    revalidatePath("/games");
    return { ok: true, won, card, netCents: s.netCents, dealer, feeCents: s.feeCents, skimCents: s.skimCents, tavCents: s.tavCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Round failed" };
  }
}

// Hi-Lo — the house shows a face card, you call higher or lower on the next.
// The stake locks at deal; the direction commits at play, the row settles once.
export async function hiloStart(input: {
  betCents: number;
  leverage: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; roundId?: string; faceCard?: number; dealer?: Persona }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const dealer = await pickDealer(input.dealerId);
    const faceCard = randomInt(52);
    const roundId = await db.transaction(async (tx) => {
      const fee = await stakeGame(tx, u.id, bet, lev, `Hi-Lo`, "hilo");
      const [r] = await tx
        .insert(schema.hiloRound)
        .values({ userId: u.id, faceCard, betCents: bet, leverage: lev, feeCents: fee })
        .returning({ id: schema.hiloRound.id });
      return r.id;
    });
    revalidatePath("/games");
    return { ok: true, roundId, faceCard, dealer };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Deal failed" };
  }
}

export async function hiloPlay(input: {
  roundId: string;
  dir: HiloDir;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; card?: number; push?: boolean; netCents?: number; mult?: number; dealer?: Persona; feeCents?: number; skimCents?: number; tavCents?: number }> {
  try {
    const u = await requireUser();
    if (input.dir !== "higher" && input.dir !== "lower") throw new Error("Pick higher or lower");
    const dealer = await pickDealer(input.dealerId);
    const out = await db.transaction(async (tx) => {
      const [round] = await tx
        .update(schema.hiloRound)
        .set({ dir: input.dir, settledAt: new Date() })
        .where(and(eq(schema.hiloRound.id, input.roundId), eq(schema.hiloRound.userId, u.id), isNull(schema.hiloRound.settledAt)))
        .returning();
      if (!round) throw new Error("Bad round token");
      const fo = cardOrder(round.faceCard);
      // Dead call — nothing beats an ace upward, nothing ducks under a 2.
      // The UI never offers it; a crafted request is refused before settle so
      // the prepaid round stays open for a real call.
      if (hiloWinRanks(fo, input.dir) <= 0) throw new Error("No card can win that call");
      // Equal rank is a push — flips never fake it; a rigged outcome redraws
      // a card that genuinely loses (or wins) the call. Draws pick uniformly
      // from the matching ranks — bounded, no retry loop to exhaust.
      const canLose = hiloWinRanks(fo, input.dir === "higher" ? "lower" : "higher") > 0;
      const draw = (wantWin: boolean) => {
        const pool: number[] = [];
        for (let o = 1; o <= 13; o++) {
          if (o !== fo && ((o > fo ? "higher" : "lower") === input.dir) === wantWin) pool.push(o);
        }
        // Card ints are rank + 13*suit; order o maps back to rank o % 13.
        return (pool[randomInt(pool.length)] % 13) + 13 * randomInt(4);
      };
      let card = randomInt(52);
      let push = cardOrder(card) === fo;
      let won = push || (cardOrder(card) > fo ? "higher" : "lower") === input.dir;
      if (dealerFx(dealer).rigged && won && !push && canLose && randomInt(100) < RIG_PCT) { card = draw(false); won = false; }
      if (!won && !push && (await maybeBless(u.id, dealer))) { card = draw(true); won = true; }
      if (won && !push && canLose && randomInt(10_000) < (await casinoRigBps())) { card = draw(false); won = false; }
      const luck = luckRoll(won, u.luckBps);
      if (!push) {
        if (luck === "win") { card = draw(true); won = true; }
        else if (luck === "lose" && canLose) { card = draw(false); won = false; }
      }
      push = cardOrder(card) === fo;
      const mult = push ? 1 : hiloMult(round.faceCard, input.dir);
      const face = cardLabel(round.faceCard), next = cardLabel(card);
      const s = await settleGame(tx, u.id, round.betCents, round.leverage, won, mult, `Hi-Lo ${input.dir} ${face.rank}${face.suit}→${next.rank}${next.suit}`, dealer, round.feeCents, "hilo");
      return { round, card, push, won, mult, ...s };
    });
    revalidatePath("/games");
    return { ok: true, won: out.won, card: out.card, push: out.push, netCents: out.netCents, mult: out.mult, dealer, feeCents: out.feeCents, skimCents: out.skimCents, tavCents: out.tavCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Play failed" };
  }
}

export async function playLimbo(input: {
  betCents: number;
  leverage: number;
  target: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; won?: boolean; roll?: number; netCents?: number; dealer?: Persona; feeCents?: number; skimCents?: number; tavCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const target = Number(input.target);
    const [limCfg] = await db.select({ pay: schema.casinoConfig.limboPayBps, minX: schema.casinoConfig.limboMinX100 }).from(schema.casinoConfig).where(eq(schema.casinoConfig.id, "house"));
    const limboMin = (limCfg?.minX ?? 110) / 100;
    const limboPay = (limCfg?.pay ?? 9600) / 10_000;
    if (!Number.isFinite(target) || target < limboMin || target > LIMBO_MAX) throw new Error("Bad target");
    // Crash point: 0.99/(1−u), clamped — win when the rocket clears the bar.
    const u1 = (randomInt(2 ** 32) + randomInt(2 ** 32) / 2 ** 32) / 2 ** 32;
    let roll = Math.min(1000, Math.max(1, 0.99 / (1 - u1)));
    let won = roll >= target;
    const dealer = await pickDealer(input.dealerId);
    if (dealerFx(dealer).rigged && won && randomInt(100) < RIG_PCT) {
      roll = Math.max(1, target * (0.3 + (randomInt(60) / 100))); // crashes under the bar
      won = false;
    }
    if (!won && (await maybeBless(u.id, dealer))) {
      roll = Math.min(1000, target * (1 + randomInt(40) / 100)); // clears the bar
      won = true;
    }
    if (won && randomInt(10_000) < (await casinoRigBps())) {
      roll = Math.max(1, target * (0.3 + randomInt(60) / 100));
      won = false;
    }
    const luck = luckRoll(won, u.luckBps);
    if (luck === "win") {
      roll = Math.min(1000, target * (1 + randomInt(40) / 100));
      won = true;
    } else if (luck === "lose") {
      roll = Math.max(1, target * (0.3 + randomInt(60) / 100));
      won = false;
    }
    const { netCents, feeCents, skimCents, tavCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, won, target * limboPay, `Limbo ≥${target}x → ${roll.toFixed(2)}x`, dealer, undefined, "limbo")
    );
    revalidatePath("/games");
    return { ok: true, won, roll: Math.round(roll * 100) / 100, netCents, dealer, feeCents, skimCents, tavCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Limbo failed" };
  }
}

export async function playWheel(input: {
  betCents: number;
  leverage: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; index?: number; mult?: number; netCents?: number; dealer?: Persona; feeCents?: number; skimCents?: number; tavCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    let index = randomInt(WHEEL_SEGMENTS.length);
    let mult = WHEEL_SEGMENTS[index];
    const dealer = await pickDealer(input.dealerId);
    if (dealerFx(dealer).rigged && mult > 0 && randomInt(100) < RIG_PCT) {
      const zeros = WHEEL_SEGMENTS.map((m, i) => (m === 0 ? i : -1)).filter((i) => i >= 0);
      index = zeros[randomInt(zeros.length)];
      mult = 0;
    }
    if (mult === 0 && (await maybeBless(u.id, dealer))) {
      const wins = WHEEL_SEGMENTS.map((m, i) => (m > 0 ? i : -1)).filter((i) => i >= 0);
      index = wins[randomInt(wins.length)];
      mult = WHEEL_SEGMENTS[index];
    }
    if (mult > 0 && randomInt(10_000) < (await casinoRigBps())) {
      const zeros = WHEEL_SEGMENTS.map((m, i) => (m === 0 ? i : -1)).filter((i) => i >= 0);
      index = zeros[randomInt(zeros.length)];
      mult = 0;
    }
    const luck = luckRoll(mult > 0, u.luckBps);
    if (luck === "win") {
      const wins = WHEEL_SEGMENTS.map((m, i) => (m > 0 ? i : -1)).filter((i) => i >= 0);
      index = wins[randomInt(wins.length)];
      mult = WHEEL_SEGMENTS[index];
    } else if (luck === "lose") {
      const zeros = WHEEL_SEGMENTS.map((m, i) => (m === 0 ? i : -1)).filter((i) => i >= 0);
      index = zeros[randomInt(zeros.length)];
      mult = 0;
    }
    const { netCents, feeCents, skimCents, tavCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, mult > 0, mult, `Wheel → ${mult}x`, dealer, undefined, "wheel")
    );
    revalidatePath("/games");
    return { ok: true, index, mult, netCents, dealer, feeCents, skimCents, tavCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Spin failed" };
  }
}

// Three reels from the weighted strip in lib/games.ts — same math both sides.
export async function playSlots(input: {
  betCents: number;
  leverage: number;
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; reels?: number[]; mult?: number; netCents?: number; dealer?: Persona; feeCents?: number; skimCents?: number; tavCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const reels = [slotDraw(randomInt(SLOT_TOTAL_WEIGHT)), slotDraw(randomInt(SLOT_TOTAL_WEIGHT)), slotDraw(randomInt(SLOT_TOTAL_WEIGHT))];
    let mult = slotPayout(reels[0], reels[1], reels[2]);
    const dealer = await pickDealer(input.dealerId);
    if (dealerFx(dealer).rigged && mult > 1 && randomInt(100) < RIG_PCT) {
      // Re-deal until a dead spin — reels visibly miss. Pushes (a lone pair
      // refunding the stake) are left alone: rigging targets real wins only.
      for (let i = 0; i < 40 && mult > 0; i++) {
        reels[0] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[1] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[2] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        mult = slotPayout(reels[0], reels[1], reels[2]);
      }
      if (mult > 0) { reels[2] = (reels[0] + 1) % SLOT_SYMBOLS.length; mult = slotPayout(reels[0], reels[1], reels[2]); }
    }
    if (mult === 0 && (await maybeBless(u.id, dealer))) {
      // Re-deal until a paying spin; worst case, force the pair home.
      for (let i = 0; i < 40 && mult === 0; i++) {
        reels[0] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[1] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[2] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        mult = slotPayout(reels[0], reels[1], reels[2]);
      }
      if (mult === 0) { reels[2] = reels[0]; mult = slotPayout(reels[0], reels[1], reels[2]); }
    }
    const riggedHouse = randomInt(10_000) < (await casinoRigBps());
    const luck = luckRoll(mult > 0, u.luckBps);
    if ((mult > 1 && riggedHouse) || luck === "lose") {
      for (let i = 0; i < 40 && mult > 0; i++) {
        reels[0] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[1] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[2] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        mult = slotPayout(reels[0], reels[1], reels[2]);
      }
      if (mult > 0) { reels[2] = (reels[0] + 1) % SLOT_SYMBOLS.length; mult = slotPayout(reels[0], reels[1], reels[2]); }
    } else if (mult === 0 && luck === "win") {
      for (let i = 0; i < 40 && mult === 0; i++) {
        reels[0] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[1] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        reels[2] = slotDraw(randomInt(SLOT_TOTAL_WEIGHT));
        mult = slotPayout(reels[0], reels[1], reels[2]);
      }
      if (mult === 0) { reels[2] = reels[0]; mult = slotPayout(reels[0], reels[1], reels[2]); }
    }
    const label = `Slots ${reels.map((i) => SLOT_SYMBOLS[i]).join(" ")}`;
    const { netCents, feeCents, skimCents, tavCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, mult > 0, mult, label, dealer, undefined, "slots")
    );
    revalidatePath("/games");
    return { ok: true, reels, mult, netCents, dealer, feeCents, skimCents, tavCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Spin failed" };
  }
}

// Plinko — the server picks every left/right bounce and returns the path, so
// the client's animation replays the settled drop rather than illustrating
// one. Rig spoils by nudging the pocket toward the middle, bless/luck nudge
// it outward — the table's unimodal, so direction maps cleanly to outcome.
export async function playPlinko(input: {
  betCents: number;
  leverage: number;
  rows?: number; // pin rows — player picks the board size
  dealerId?: string;
}): Promise<{ ok: boolean; error?: string; path?: number[]; bucket?: number; mult?: number; rows?: number; netCents?: number; dealer?: Persona; feeCents?: number; skimCents?: number; tavCents?: number }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    const rows = PLINKO_ROW_CHOICES.includes(input.rows as (typeof PLINKO_ROW_CHOICES)[number]) ? input.rows! : PLINKO_ROWS;
    const mults = plinkoMults(rows);
    const center = rows / 2;
    let path = Array.from({ length: rows }, () => (randomInt(2) === 1 ? 1 : 0));
    let bucket = plinkoBucket(path);
    let mult = mults[bucket];
    // Walk toward the middle until the pocket stops paying, walk outward until
    // it does — bounded so a nudge always terminates at the board's edge.
    const spoil = (k: number) => {
      while (k !== center && mults[k] > 1) k += k < center ? 1 : -1;
      return k;
    };
    const rescue = (k: number) => {
      while (k > 0 && k < rows && mults[k] <= 1)
        k += k < center ? -1 : k > center ? 1 : randomInt(2) ? -1 : 1;
      return k;
    };
    const move = (k: number) => {
      bucket = k;
      path = plinkoPathForBucket(k, randomInt, rows);
      mult = mults[k];
    };
    const dealer = await pickDealer(input.dealerId);
    if (dealerFx(dealer).rigged && mult > 1 && randomInt(100) < RIG_PCT) move(spoil(bucket));
    if (mult <= 1 && (await maybeBless(u.id, dealer))) move(rescue(bucket));
    if (mult > 1 && randomInt(10_000) < (await casinoRigBps())) move(spoil(bucket));
    const luck = luckRoll(mult > 1, u.luckBps);
    if (luck === "win") move(rescue(bucket));
    else if (luck === "lose") move(spoil(bucket));
    const { netCents, feeCents, skimCents, tavCents } = await db.transaction(async (tx) =>
      settleGame(tx, u.id, bet, lev, mult > 0, mult, `Plinko ${rows}r → pocket ${bucket} ×${mult}`, dealer, undefined, "plinko")
    );
    revalidatePath("/games");
    return { ok: true, path, bucket, mult, rows, netCents, dealer, feeCents, skimCents, tavCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Drop failed" };
  }
}

// ---------- referral ----------

// Referee gets Ɱ100 once; the referrer gets Ɱ200 per friend who joins.
// The referrer row is keyed bonus:referrer:<refereeId> so reward_once_idx
// allows unlimited referrals while still blocking the same pair twice.
export async function claimReferral(input: { ref: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const ref = input.ref.trim().toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(ref)) throw new Error("Invalid referral link");
    if (ref === (u.username ?? "").toLowerCase()) throw new Error("Can't refer yourself");
    await db.transaction(async (tx) => {
      // Lock before the already-used check — two concurrent claims could
      // otherwise both pass and double-mint both bonuses.
      await lockUser(tx, u.id);
      const [used] = await tx
        .select({ id: schema.rewardClaim.id })
        .from(schema.rewardClaim)
        .where(and(eq(schema.rewardClaim.userId, u.id), eq(schema.rewardClaim.kind, "bonus:referral")))
        .limit(1);
      if (used) throw new Error("Referral already used");
      const [refUser] = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(sql`lower(${schema.user.username}) = ${ref}`)
        .limit(1);
      if (!refUser) throw new Error("Referrer not found");
      await tx.insert(schema.rewardClaim).values({ userId: u.id, kind: "bonus:referral", amountCents: REFEREE_BONUS });
      await credit(tx, u.id, REFEREE_BONUS, "bonus", null, `Referral bonus via @${ref}`);
      await tx.insert(schema.rewardClaim).values({
        userId: refUser.id,
        kind: `bonus:referrer:${u.id}`,
        amountCents: REFERRER_BONUS,
      });
      await credit(tx, refUser.id, REFERRER_BONUS, "bonus", null, `Referral: @${u.username ?? u.name} joined`);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Referral failed" };
  }
}

// Referral royalty: 5% of each invitee's lifetime earned income, claimable
// repeatedly. bonus:royalty:<refereeId> rows store cumulative paid cents, so
// a claim sweeps only the delta — idempotent under retries and concurrency.
export async function claimReferralRoyalties(): Promise<{ ok: boolean; error?: string; creditedCents?: number; count?: number }> {
  try {
    const u = await requireUser();
    const res = await db.transaction(async (tx) => {
      await lockUser(tx, u.id);
      const rows = await tx
        .select({ kind: schema.rewardClaim.kind, amountCents: schema.rewardClaim.amountCents })
        .from(schema.rewardClaim)
        .where(
          and(
            eq(schema.rewardClaim.userId, u.id),
            // refer% alone misses royalty rows — both prefixes are needed.
            sql`(${schema.rewardClaim.kind} like 'bonus:refer%' or ${schema.rewardClaim.kind} like 'bonus:royalty:%')`
          )
        );
      const refIds = rows.filter((r) => r.kind.startsWith("bonus:referrer:")).map((r) => r.kind.slice("bonus:referrer:".length));
      if (!refIds.length) throw new Error("No referrals yet");
      const paid = new Map(
        rows.filter((r) => r.kind.startsWith("bonus:royalty:")).map((r) => [r.kind.slice("bonus:royalty:".length), r.amountCents])
      );
      // Same epoch rule as the display query — earnings before stats_since
      // don't feed royalties.
      const statsSince = await getStatsSince();
      const [earned, names] = await Promise.all([
        tx
          .select({ userId: schema.ledger.userId, cents: sql<number>`coalesce(sum(${schema.ledger.amountCents}),0)::bigint` })
          .from(schema.ledger)
          .where(
            and(
              inArray(schema.ledger.userId, refIds),
              sql`${schema.ledger.amountCents} > 0`,
              inArray(schema.ledger.kind, [...REFERRAL_EARN_KINDS]),
              statsSince ? gte(schema.ledger.createdAt, statsSince) : undefined
            )
          )
          .groupBy(schema.ledger.userId),
        tx
          .select({ id: schema.user.id, username: schema.user.username })
          .from(schema.user)
          .where(inArray(schema.user.id, refIds)),
      ]);
      const earnedMap = new Map(earned.map((e) => [e.userId, Number(e.cents)]));
      const nameMap = new Map(names.map((n) => [n.id, n.username ?? n.id.slice(0, 6)]));
      const [refCfg] = await tx.select({ bps: schema.casinoConfig.referralRoyaltyBps, cap: schema.casinoConfig.referralRoyaltyCapCents }).from(schema.casinoConfig).where(eq(schema.casinoConfig.id, "house"));
      const royBps = refCfg?.bps ?? REFERRAL_ROYALTY_BPS;
      const royCap = refCfg?.cap ?? REFERRAL_ROYALTY_CAP_CENTS;
      let credited = 0;
      let count = 0;
      for (const rid of refIds) {
        const total = Math.min(
          Math.floor(((earnedMap.get(rid) ?? 0) * royBps) / 10_000),
          royCap
        );
        const due = total - (paid.get(rid) ?? 0);
        if (due <= 0) continue;
        await credit(tx, u.id, due, "bonus", null, `Referral royalty: @${nameMap.get(rid)} earned ${((earnedMap.get(rid) ?? 0) / 100).toFixed(0)}Ɱ`);
        if (paid.has(rid)) {
          await tx
            .update(schema.rewardClaim)
            .set({ amountCents: total })
            .where(and(eq(schema.rewardClaim.userId, u.id), eq(schema.rewardClaim.kind, `bonus:royalty:${rid}`)));
        } else {
          await tx.insert(schema.rewardClaim).values({ userId: u.id, kind: `bonus:royalty:${rid}`, amountCents: total });
        }
        credited += due;
        count++;
      }
      if (!count) throw new Error("Nothing new to claim");
      return { credited, count };
    });
    revalidatePath("/rewards");
    return { ok: true, creditedCents: res.credited, count: res.count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ---------- market likes (heart also drives the watchlist) ----------

export async function toggleLike(input: { marketId: string }): Promise<{ ok: boolean; error?: string; liked?: boolean }> {
  try {
    const u = await requireUser();
    const where = and(eq(schema.marketLike.userId, u.id), eq(schema.marketLike.marketId, input.marketId));
    const watch = and(eq(schema.watchlist.userId, u.id), eq(schema.watchlist.marketId, input.marketId));
    const [existing] = await db.select().from(schema.marketLike).where(where).limit(1);
    if (existing) {
      // Unliking also unwatches — the heart is the single like+watch gesture.
      await db.delete(schema.marketLike).where(where);
      await db.delete(schema.watchlist).where(watch);
      return { ok: true, liked: false };
    }
    await db.insert(schema.marketLike).values({ userId: u.id, marketId: input.marketId });
    await db.insert(schema.watchlist).values({ userId: u.id, marketId: input.marketId }).onConflictDoNothing();
    return { ok: true, liked: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ---------- duels ----------

// A challenges B: the claim is just text both sides agreed on — settlement is
// mutual, with admins breaking disputes. Stakes escrow through the ledger.
export async function createDuel(input: {
  opponent: string;
  claim: string;
  stakeCents: number;
  kind?: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const u = await requireUser();
    const kind = (DUEL_KINDS as readonly string[]).includes(input.kind ?? "claim") ? (input.kind as DuelKind) : "claim";
    // Kill-switch — a disabled game can't host new duels.
    const gameKey = DUEL_GAME_KEY[kind];
    if (gameKey) {
      const [cfg] = await db.select({ d: schema.casinoConfig.disabledGames }).from(schema.casinoConfig).where(eq(schema.casinoConfig.id, "house"));
      if (cfg?.d?.includes(gameKey)) throw new Error("This game is temporarily disabled");
    }
    const claim = kind === "claim" ? input.claim.trim() : DUEL_NAMES[kind];
    if (kind === "claim" && claim.length < 5) throw new Error("Describe the bet (min 5 chars)");
    if (kind === "claim" && claim.length > 200) throw new Error("Claim too long (max 200)");
    const stake = Math.round(input.stakeCents);
    if (!Number.isFinite(stake) || stake < 100) throw new Error("Minimum stake is Ɱ 1");
    if (stake > 10_000_000) throw new Error("Maximum stake is Ɱ 100,000");
    const id = await db.transaction(async (tx) => {
      const [opp] = await tx
        .select({ id: schema.user.id, username: schema.user.username, balanceCents: schema.user.balanceCents })
        .from(schema.user)
        .where(sql`lower(${schema.user.username}) = lower(${input.opponent.trim().replace(/^@/, "")})`)
        .limit(1);
      if (!opp) throw new Error("No such user");
      if (opp.id === u.id) throw new Error("Pick someone else");
      await lockUser(tx, u.id);
      await credit(tx, u.id, -stake, "duel", null, `Duel stake vs @${opp.username}: ${claim.slice(0, 60)}`);
      const [row] = await tx.insert(schema.challenge).values({ creatorId: u.id, opponentId: opp.id, claim, stakeCents: stake, kind }).returning({ id: schema.challenge.id });
      await ping(tx, opp.id, `Duel invite from @${u.username ?? u.name}: ${claim.slice(0, 70)}`);
      return row.id;
    });
    revalidatePath("/duels");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Duel failed" };
  }
}

export async function respondDuel(input: {
  id: string;
  accept: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.challenge).where(eq(schema.challenge.id, input.id)).for("update").limit(1);
      if (!c || c.opponentId !== u.id) throw new Error("Not your duel");
      if (c.status !== "open") throw new Error("Already answered");
      if (input.accept) {
        await lockUser(tx, u.id);
        await credit(tx, u.id, -c.stakeCents, "duel", null, `Duel stake: ${c.claim.slice(0, 70)}`);
        await ping(tx, c.creatorId, `@${u.username ?? u.name} accepted your duel: ${c.claim.slice(0, 60)}`);
        await tx.update(schema.challenge).set({ status: "accepted" }).where(eq(schema.challenge.id, c.id));
      } else {
        await lockUser(tx, c.creatorId);
        await credit(tx, c.creatorId, c.stakeCents, "duel", null, `Duel declined: ${c.claim.slice(0, 60)}`);
        await ping(tx, c.creatorId, `@${u.username ?? u.name} declined your duel: ${c.claim.slice(0, 60)}`);
        await tx.update(schema.challenge).set({ status: "declined" }).where(eq(schema.challenge.id, c.id));
      }
    });
    revalidatePath("/duels");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function cancelDuel(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.challenge).where(eq(schema.challenge.id, input.id)).for("update").limit(1);
      if (!c || c.creatorId !== u.id) throw new Error("Not your duel");
      if (c.status !== "open") throw new Error("Too late to cancel");
      await lockUser(tx, c.creatorId);
      await credit(tx, c.creatorId, c.stakeCents, "duel", null, `Duel cancelled: ${c.claim.slice(0, 60)}`);
      await tx.update(schema.challenge).set({ status: "cancelled" }).where(eq(schema.challenge.id, c.id));
    });
    revalidatePath("/duels");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// One side names the winner; the other side confirms by naming the same one.
// Contradictory proposals flip the duel to 'disputed' for an admin.
export async function proposeDuelWinner(input: {
  id: string;
  winnerId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.challenge).where(eq(schema.challenge.id, input.id)).for("update").limit(1);
      if (!c) throw new Error("Duel not found");
      if (u.id !== c.creatorId && u.id !== c.opponentId) throw new Error("Not your duel");
      if (input.winnerId !== c.creatorId && input.winnerId !== c.opponentId) throw new Error("Pick a participant");
      if (c.status !== "accepted" && c.status !== "disputed") throw new Error("Not settleable");
      if (c.pendingById && c.pendingById !== u.id) {
        // Counterparty already proposed — agreeing settles, disagreeing disputes.
        if (c.pendingWinnerId === input.winnerId) {
          // Profit is one stake — the vow skims its share off the pot.
          const g = await garnishDebt(tx, input.winnerId, c.stakeCents, "Duel");
          await credit(tx, input.winnerId, c.stakeCents * 2 - g, "duel", null, `Duel won: ${c.claim.slice(0, 60)}`);
          // Both participants hear the verdict — the loser gets no credit row.
          await ping(tx, input.winnerId, `Duel won — pot is yours${g > 0 ? ` (Ɱ${(g / 100).toFixed(2)} to debt)` : ""}: ${c.claim.slice(0, 50)}`);
          const loserId = input.winnerId === c.creatorId ? c.opponentId : c.creatorId;
          await ping(tx, loserId, `Duel lost: ${c.claim.slice(0, 60)}`);
          await tx
            .update(schema.challenge)
            .set({ status: "settled", winnerId: input.winnerId, settledAt: new Date(), pendingWinnerId: null, pendingById: null, state: { ...((c.state ?? {}) as object), skimCents: g } })
            .where(eq(schema.challenge.id, c.id));
        } else {
          await tx
            .update(schema.challenge)
            .set({ status: "disputed", pendingWinnerId: input.winnerId, pendingById: u.id })
            .where(eq(schema.challenge.id, c.id));
        }
      } else {
        await tx
          .update(schema.challenge)
          .set({ pendingWinnerId: input.winnerId, pendingById: u.id })
          .where(eq(schema.challenge.id, c.id));
      }
    });
    revalidatePath("/duels");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// Game duels: each side plays one free round of the chosen game inside the
// duel — nothing is wagered in the round itself, only the locked stake moves.
// Kinds fall into three shapes: pick-pairs resolved by one shared draw
// (coinflip/redblack), one-shot draws scored numerically, and multi-phase
// rounds (hilo deal→call, timer start→stop, blackjack hit/stand) that hold a
// mid-round state until done. Moves stay hidden from the opponent until the
// duel settles; equal scores clear the board and replay.
export async function duelPlay(input: {
  id: string;
  move?: string;
}): Promise<{ ok: boolean; error?: string; waiting?: boolean; mid?: boolean; tie?: boolean; settled?: boolean }> {
  try {
    const u = await requireUser();
    const outcome = await db.transaction(async (tx): Promise<{ o: "waiting" | "tie" | "settled"; mid?: boolean }> => {
      const [c] = await tx.select().from(schema.challenge).where(eq(schema.challenge.id, input.id)).for("update").limit(1);
      if (!c || (u.id !== c.creatorId && u.id !== c.opponentId)) throw new Error("Not your duel");
      if (c.status !== "accepted") throw new Error("Not playable");
      if (c.kind === "claim") throw new Error("Claim duels settle by agreement");
      type MoveMap = Record<string, DuelMove>;
      const moves: MoveMap = { ...(((c.state as { moves?: MoveMap } | null)?.moves) ?? {}) };
      const mine = moves[u.id];
      if (mine !== undefined && (typeof mine !== "object" || mine.done)) throw new Error("Move already locked");
      const act = input.move ?? "go";

      // One step of the player's round; returns their (new) move value.
      const step = (): DuelMove => {
        switch (c.kind) {
          case "rps": {
            const pick = act as RpsMove;
            if (!(RPS_MOVES as readonly string[]).includes(pick)) throw new Error("Pick rock, paper or scissors");
            return pick;
          }
          case "coinflip": {
            if (act !== "heads" && act !== "tails") throw new Error("Pick heads or tails");
            return { done: true, pick: act };
          }
          case "redblack": {
            if (act !== "red" && act !== "black") throw new Error("Pick red or black");
            return { done: true, pick: act };
          }
          case "roll":
            return randomInt(1, 101); // d100
          case "dice":
            return randomInt(1, 7); // d6
          case "wheel":
            return WHEEL_SEGMENTS[randomInt(0, WHEEL_SEGMENTS.length)];
          case "slots": {
            const draw = [slotDraw(randomInt(0, SLOT_TOTAL_WEIGHT)), slotDraw(randomInt(0, SLOT_TOTAL_WEIGHT)), slotDraw(randomInt(0, SLOT_TOTAL_WEIGHT))];
            return { done: true, s: slotPayout(draw[0], draw[1], draw[2]), data: { reels: draw } };
          }
          case "plinko": {
            const path = Array.from({ length: PLINKO_ROWS }, () => randomInt(2));
            const bucket = plinkoBucket(path);
            return { done: true, s: PLINKO_MULT[bucket], data: { path, bucket } };
          }
          case "limbo": {
            const target = Number(act);
            if (!Number.isFinite(target) || target < LIMBO_MIN || target > LIMBO_MAX)
              throw new Error(`Pick a target between ${LIMBO_MIN} and ${LIMBO_MAX}`);
            const crash = Math.floor((0.99 / (1 - randomInt(1_000_000_000) / 1_000_000_000)) * 100) / 100;
            const hit = crash >= target;
            return { done: true, s: hit ? target : 0, data: { target, crash } };
          }
          case "hilo": {
            if (mine === undefined) {
              if (act !== "deal") throw new Error("Deal first");
              return { done: false, data: { face: randomInt(52) } };
            }
            const pending = typeof mine === "object" && !mine.done ? mine : null;
            if (!pending || (act !== "higher" && act !== "lower")) throw new Error("Call higher or lower");
            const face = Number(pending.data?.face);
            const card = randomInt(52);
            const fo = cardOrder(face);
            const co = cardOrder(card);
            const push = co === fo;
            const won = !push && (act === "higher" ? co > fo : co < fo);
            // Score = the drawn rank when the call survives; 0 on a miss.
            return { done: true, s: push || won ? co : 0, data: { face, card, dir: act, won, push } };
          }
          case "timer": {
            if (mine === undefined) {
              if (act !== "start") throw new Error("Start the timer first");
              return { done: false, data: { t0: Date.now() } };
            }
            const pending = typeof mine === "object" && !mine.done ? mine : null;
            if (!pending || act !== "stop") throw new Error("Stop the timer");
            const err = Math.abs(Date.now() - Number(pending.data?.t0) - DUEL_TIMER_MS);
            return { done: true, s: -err, data: { err } };
          }
          case "blackjack": {
            if (mine === undefined) {
              if (act !== "deal") throw new Error("Deal first");
              const hand = [randomInt(BJ_DECKS * 52), randomInt(BJ_DECKS * 52)];
              if (isNatural(hand)) return { done: true, s: 22, data: { hand, natural: true } };
              return { done: false, data: { hand } };
            }
            const pending = typeof mine === "object" && !mine.done ? mine : null;
            if (!pending || (act !== "hit" && act !== "stand")) throw new Error("Hit or stand");
            const hand = [...((pending.data?.hand as number[] | undefined) ?? [])];
            if (act === "hit") hand.push(randomInt(BJ_DECKS * 52));
            const { total } = handTotal(hand);
            const bust = total > 21;
            if (bust) return { done: true, s: 0, data: { hand, bust: true } };
            if (act === "stand" || total === 21) return { done: true, s: total, data: { hand } };
            return { done: false, data: { hand } };
          }
          default:
            throw new Error("Unknown duel kind");
        }
      };
      moves[u.id] = step();

      const other = u.id === c.creatorId ? c.opponentId : c.creatorId;
      const theirs = moves[other];
      const done = (mv: DuelMove | undefined) => mv !== undefined && (typeof mv !== "object" || mv.done);
      const save = () => tx.update(schema.challenge).set({ state: { moves } }).where(eq(schema.challenge.id, c.id));
      if (!done(moves[u.id]) || !done(theirs)) {
        await save();
        // Only ping once the round actually concludes — mid-round steps stay quiet.
        const mid = !done(moves[u.id]);
        if (!mid) await ping(tx, other, `Duel waiting for your move: ${c.claim.slice(0, 60)}`);
        return { o: "waiting", mid };
      }

      let winner: string | null = null;
      const mineF = moves[u.id]!;
      const theirsF = theirs!;
      if (c.kind === "rps") {
        if (mineF !== theirsF) winner = RPS_BEATS[mineF as RpsMove] === theirsF ? u.id : other;
      } else if (c.kind === "coinflip" || c.kind === "redblack") {
        const myPick = typeof mineF === "object" ? mineF.pick : undefined;
        const theirPick = typeof theirsF === "object" ? theirsF.pick : undefined;
        if (myPick !== theirPick) {
          // Opposing picks — one shared draw decides who called it right.
          if (c.kind === "coinflip") {
            const landed = randomInt(2) === 0 ? "heads" : "tails";
            winner = myPick === landed ? u.id : other;
            (mineF as { data?: Record<string, unknown> }).data = { landed };
            (theirsF as { data?: Record<string, unknown> }).data = { landed };
          } else {
            const card = randomInt(52);
            const landed = cardIsRed(card) ? "red" : "black";
            winner = myPick === landed ? u.id : other;
            (mineF as { data?: Record<string, unknown> }).data = { card };
            (theirsF as { data?: Record<string, unknown> }).data = { card };
          }
        }
      } else {
        const scoreOf = (mv: DuelMove) => (typeof mv === "object" ? Number(mv.s ?? 0) : Number(mv));
        const a = scoreOf(mineF);
        const b = scoreOf(theirsF);
        if (a !== b) winner = a > b ? u.id : other;
      }

      if (winner === null) {
        await tx.update(schema.challenge).set({ state: { moves: {} } }).where(eq(schema.challenge.id, c.id));
        await ping(tx, other, `Duel tied — play again: ${c.claim.slice(0, 60)}`);
        return { o: "tie" };
      }
      const loser = winner === c.creatorId ? c.opponentId : c.creatorId;
      const g = await garnishDebt(tx, winner, c.stakeCents, "Duel");
      await credit(tx, winner, c.stakeCents * 2 - g, "duel", null, `Duel won: ${c.claim.slice(0, 60)}`);
      await ping(tx, winner, `Duel won — pot is yours${g > 0 ? ` (Ɱ${(g / 100).toFixed(2)} to debt)` : ""}: ${c.claim.slice(0, 50)}`);
      await ping(tx, loser, `Duel lost: ${c.claim.slice(0, 60)}`);
      await tx
        .update(schema.challenge)
        .set({ status: "settled", winnerId: winner, settledAt: new Date(), state: { moves, skimCents: g } })
        .where(eq(schema.challenge.id, c.id));
      return { o: "settled" };
    });
    revalidatePath("/duels");
    revalidatePath(`/duels/${input.id}`);
    return { ok: true, waiting: outcome.o === "waiting", mid: outcome.mid, tie: outcome.o === "tie", settled: outcome.o === "settled" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// Admin tiebreak for disputed duels — or any stuck one. winnerId null refunds
// both stakes; a winner gets the full pot.
export async function adminSettleDuel(input: {
  id: string;
  winnerId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (!isAdmin(u)) throw new Error("Admin only");
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.challenge).where(eq(schema.challenge.id, input.id)).for("update").limit(1);
      if (!c) throw new Error("Duel not found");
      if (c.status !== "accepted" && c.status !== "disputed") throw new Error("Nothing to settle");
      if (input.winnerId && input.winnerId !== c.creatorId && input.winnerId !== c.opponentId)
        throw new Error("Pick a participant");
      let g = 0;
      if (input.winnerId) {
        g = await garnishDebt(tx, input.winnerId, c.stakeCents, "Duel");
        await credit(tx, input.winnerId, c.stakeCents * 2 - g, "duel", null, `Duel won (admin): ${c.claim.slice(0, 55)}`);
        await ping(tx, input.winnerId, `Duel settled by admin — you won${g > 0 ? ` (Ɱ${(g / 100).toFixed(2)} to debt)` : ""}: ${c.claim.slice(0, 50)}`);
        const loserId = input.winnerId === c.creatorId ? c.opponentId : c.creatorId;
        await ping(tx, loserId, `Duel settled by admin — you lost: ${c.claim.slice(0, 55)}`);
      } else {
        await lockUser(tx, c.creatorId);
        await credit(tx, c.creatorId, c.stakeCents, "duel", null, `Duel refunded: ${c.claim.slice(0, 60)}`);
        await lockUser(tx, c.opponentId);
        await credit(tx, c.opponentId, c.stakeCents, "duel", null, `Duel refunded: ${c.claim.slice(0, 60)}`);
        await ping(tx, c.creatorId, `Duel refunded by admin: ${c.claim.slice(0, 60)}`);
        await ping(tx, c.opponentId, `Duel refunded by admin: ${c.claim.slice(0, 60)}`);
      }
      await tx
        .update(schema.challenge)
        .set({ status: "settled", winnerId: input.winnerId, settledAt: new Date(), pendingWinnerId: null, pendingById: null, state: { ...((c.state ?? {}) as object), skimCents: g } })
        .where(eq(schema.challenge.id, c.id));
    });
    revalidatePath("/duels");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ---------- squads + notification prefs ----------

// Create-or-join by name — squad membership is open in a friend group.
export async function joinSquad(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const clean = name.trim();
    if (clean.length < 2) throw new Error("Squad name too short");
    if (clean.length > 24) throw new Error("Squad name too long (max 24)");
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.squad).where(sql`lower(${schema.squad.name}) = lower(${clean})`).limit(1);
      const squadId = existing?.id ?? (await tx.insert(schema.squad).values({ name: clean, createdBy: u.id }).returning({ id: schema.squad.id }))[0].id;
      await tx.update(schema.user).set({ squadId }).where(eq(schema.user.id, u.id));
    });
    revalidatePath("/leaderboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function leaveSquad(): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const me = await lockUser(tx, u.id);
      if (me.squadDebtCents > 0) throw new Error("Repay your squad loan first");
      await tx.update(schema.user).set({ squadId: null }).where(eq(schema.user.id, u.id));
      await tx.delete(schema.squadInvite).where(eq(schema.squadInvite.inviteeId, u.id));
    });
    revalidatePath("/leaderboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// Invite a user by username — lands on their profile's squad card plus a
// notification. Accepting joins the squad and clears all pending invites.
export async function inviteToSquad(username: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const [me] = await db
      .select({ squadId: schema.user.squadId })
      .from(schema.user)
      .where(eq(schema.user.id, u.id))
      .limit(1);
    if (!me?.squadId) throw new Error("Join a squad first");
    const name = username.trim().replace(/^@/, "");
    const [target] = await db
      .select({ id: schema.user.id, username: schema.user.username, squadId: schema.user.squadId, balanceCents: schema.user.balanceCents })
      .from(schema.user)
      .where(sql`lower(${schema.user.username}) = lower(${name})`)
      .limit(1);
    if (!target) throw new Error("No such user");
    if (target.id === u.id) throw new Error("That's you");
    if (target.squadId === me.squadId) throw new Error("Already in your squad");
    // Squads are exclusive — don't offer a chair to someone already seated.
    if (target.squadId) throw new Error("Already in a squad");
    const [sq] = await db.select().from(schema.squad).where(eq(schema.squad.id, me.squadId)).limit(1);
    const inserted = await db
      .insert(schema.squadInvite)
      .values({ squadId: me.squadId, inviterId: u.id, inviteeId: target.id })
      .onConflictDoNothing()
      .returning({ id: schema.squadInvite.id });
    // Duplicate invite → no new row → no second bell ping.
    if (!inserted.length) return { ok: true };
    await ping(db, target.id, `@${u.username ?? u.name} invited you to squad “${sq.name}” — see your profile`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function respondSquadInvite(input: {
  inviteId: string;
  accept: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(schema.squadInvite)
        .where(and(eq(schema.squadInvite.id, input.inviteId), eq(schema.squadInvite.inviteeId, u.id)))
        .limit(1)
        .for("update");
      if (!inv) throw new Error("Invite not found");
      if (input.accept) {
        const cur = await lockUser(tx, u.id);
        // Stale invite after already joining a squad — delete it, don't hop.
        if (cur.squadId) {
          await tx.delete(schema.squadInvite).where(eq(schema.squadInvite.id, inv.id));
          throw new Error("You're already in a squad");
        }
        await tx.update(schema.user).set({ squadId: inv.squadId }).where(eq(schema.user.id, u.id));
        await tx.delete(schema.squadInvite).where(eq(schema.squadInvite.inviteeId, u.id));
      } else {
        await tx.delete(schema.squadInvite).where(eq(schema.squadInvite.id, inv.id));
      }
    });
    revalidatePath("/leaderboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ---------- squad money ----------

// Transfers and the shared pot — money stays inside the squad. Ledger kind
// "transfer" is net-zero for the house: it never touches stats or volume.
const SQUAD_MIN_CENTS = 100; // Ɱ1

async function lockMySquad(tx: Tx, userId: string) {
  const me = await lockUser(tx, userId);
  if (!me.squadId) throw new Error("Join a squad first");
  const [sq] = await tx.select().from(schema.squad).where(eq(schema.squad.id, me.squadId)).for("update").limit(1);
  if (!sq) throw new Error("Squad not found");
  return { me, sq };
}

// Direct member→member send. Squad-mates only — keeps it a trust circle,
// not a public payments rail.
export async function squadSend(username: string, amountCents: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const cents = Math.round(amountCents);
    if (!Number.isSafeInteger(cents) || cents < SQUAD_MIN_CENTS) throw new Error("Minimum Ɱ1");
    const clean = username.trim().replace(/^@/, "");
    await db.transaction(async (tx) => {
      const { me } = await lockMySquad(tx, u.id);
      const [target] = await tx
        .select()
        .from(schema.user)
        .where(sql`lower(${schema.user.username}) = lower(${clean})`)
        .for("update")
        .limit(1);
      if (!target) throw new Error("User not found");
      if (target.id === u.id) throw new Error("That's you");
      if (target.squadId !== me.squadId) throw new Error("Not in your squad");
      await credit(tx, u.id, -cents, "transfer", null, `Squad send → @${target.username ?? target.name}`);
      await credit(tx, target.id, cents, "transfer", null, `Squad send ← @${me.username ?? me.name}`);
      await ping(tx, target.id, `@${me.username ?? me.name} sent you Ɱ${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    });
    revalidatePath("/squads");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Transfer failed" };
  }
}

// Balance → pot.
export async function squadContribute(amountCents: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const cents = Math.round(amountCents);
    if (!Number.isSafeInteger(cents) || cents < SQUAD_MIN_CENTS) throw new Error("Minimum Ɱ1");
    await db.transaction(async (tx) => {
      const { sq } = await lockMySquad(tx, u.id);
      await credit(tx, u.id, -cents, "transfer", null, `Squad pot — contributed to ${sq.name}`);
      await tx.update(schema.squad).set({ treasuryCents: sq.treasuryCents + cents }).where(eq(schema.squad.id, sq.id));
    });
    revalidatePath("/squads");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Contribution failed" };
  }
}

// Pot → balance, tracked as squadDebtCents. Interest-free — the constraint
// is social: you can't leave the squad until it's repaid.
export async function squadBorrow(amountCents: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const cents = Math.round(amountCents);
    if (!Number.isSafeInteger(cents) || cents < SQUAD_MIN_CENTS) throw new Error("Minimum Ɱ1");
    await db.transaction(async (tx) => {
      const { me, sq } = await lockMySquad(tx, u.id);
      if (cents > sq.treasuryCents) throw new Error("Pot doesn't cover that");
      await tx.update(schema.squad).set({ treasuryCents: sq.treasuryCents - cents }).where(eq(schema.squad.id, sq.id));
      await tx.update(schema.user).set({ squadDebtCents: me.squadDebtCents + cents }).where(eq(schema.user.id, u.id));
      await credit(tx, u.id, cents, "transfer", null, `Squad loan — from ${sq.name} pot`);
    });
    revalidatePath("/squads");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Borrow failed" };
  }
}

// Balance → pot, paying down squadDebtCents. Overpay is refused.
export async function squadRepay(amountCents: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    const cents = Math.round(amountCents);
    if (!Number.isSafeInteger(cents) || cents < SQUAD_MIN_CENTS) throw new Error("Minimum Ɱ1");
    await db.transaction(async (tx) => {
      const { me, sq } = await lockMySquad(tx, u.id);
      if (me.squadDebtCents <= 0) throw new Error("Nothing to repay");
      const pay = Math.min(cents, me.squadDebtCents);
      await credit(tx, u.id, -pay, "transfer", null, `Squad repay — ${sq.name} pot`);
      await tx.update(schema.user).set({ squadDebtCents: me.squadDebtCents - pay }).where(eq(schema.user.id, u.id));
      await tx.update(schema.squad).set({ treasuryCents: sq.treasuryCents + pay }).where(eq(schema.squad.id, sq.id));
    });
    revalidatePath("/squads");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Repay failed" };
  }
}

export async function setNotifPrefs(input: {
  resolve: boolean;
  closing: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    await db
      .update(schema.user)
      .set({ notifResolve: input.resolve, notifClosing: input.closing })
      .where(eq(schema.user.id, u.id));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

// ---------- blackjack ----------
// Interactive round: the shoe and both hands live on blackjack_round so the
// client only ever asks "hit"/"stand". Stake + funding fee are charged at
// deal; the worst case forfeits both — no debt, same margin rules as the
// other games.

const BJ_FALLBACK_DEALER: Persona = { name: "The House", avatar: "", quipWin: "The house always collects.", quipLose: "Well played." };
const BJ_ROUND_TTL_MS = 60 * 60_000; // abandoned hands settle as a push

// One active dealer fronts each round of every minigame — the player picks
// theirs; absent or invalid picks fall back to a random active persona.
// Blackjack keeps it on the round row, instant games return it in the result.
async function pickDealer(dealerId?: string): Promise<Persona> {
  const dealers = await db.select().from(schema.dealerPersona).where(eq(schema.dealerPersona.active, true));
  const picked = dealerId ? dealers.find((d) => d.id === dealerId) : null;
  const d = picked ?? (dealers.length > 0 ? dealers[randomInt(dealers.length)] : null);
  return d ? { id: d.id, name: d.name, avatar: d.avatar, quipWin: d.quipWin, quipLose: d.quipLose } : BJ_FALLBACK_DEALER;
}

function shuffledShoe(): number[] {
  const d = Array.from({ length: BJ_DECKS * 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// Settle a round under margin rules: a win pays stake + (mult-1) × notional,
// a loss forfeits the stake only — the funding fee (paid at deal) burns either
// way. No debt is ever created. `loanCents` on the row stores the fee paid.
async function settleBlackjack(
  tx: Tx,
  round: { id: string; userId: string; betCents: number; leverage: number; persona: Persona; loanCents?: number | null },
  result: "win" | "lose" | "push" | "blackjack" | "surrender",
  dealerName: string
): Promise<{ net: number; feeCents: number; skim: number; tav: number }> {
  const label = `Blackjack vs ${dealerName}`;
  const fee = round.loanCents ?? levFeeCents(round.betCents, round.leverage) + GAME_FEE_CENTS;
  // Lock the user row first — garnishDebt/telAvivBonus read it post-lock.
  await lockUser(tx, round.userId);
  // The margin borrowed at deal/double is released by every non-loss result;
  // on a loss it stays booked — that's the leveraged loss the house collects.
  const borrowed = round.betCents * (round.leverage - 1);
  const owed = result === "lose" ? borrowed : 0;
  const release = borrowed - owed;
  if (release > 0) await releaseDebt(tx, round.userId, release, `${label} — leverage repaid Ɱ${(release / 100).toFixed(2)}`);
  let net: number;
  let skim = 0;
  let tav = 0;
  if (result === "win" || result === "blackjack") {
    const mult = result === "blackjack" ? BJ_NATURAL_MULT : BJ_WIN_MULT;
    const win = levWinCents(round.betCents, round.leverage, mult);
    skim = Math.min(win, await garnishDebt(tx, round.userId, win - round.betCents, label));
    const take = win - skim;
    if (take > 0) await credit(tx, round.userId, take, "game", null, `${label} — ${result === "blackjack" ? "natural 21" : "won"} ×${mult}${skim ? " (debt repaid)" : ""}`);
    if (dealerFx(round.persona).blessed) tav = await telAvivBonus(tx, round.userId);
    net = win - skim - round.betCents - fee;
  } else if (result === "surrender") {
    // Forfeit half the stake; the fee is spent either way.
    const refund = Math.round(round.betCents / 2);
    await credit(tx, round.userId, refund, "game", null, `${label} — surrendered, half stake back`);
    net = refund - round.betCents - fee;
  } else if (result === "push") {
    await credit(tx, round.userId, round.betCents, "game", null, `${label} — push, stake back`);
    net = -fee;
  } else {
    net = -(round.betCents + fee + owed);
  }
  await tx
    .update(schema.blackjackRound)
    .set({ status: "settled", result, netCents: net, settledAt: new Date(), loanCents: fee })
    .where(eq(schema.blackjackRound.id, round.id));
  return { net, feeCents: fee, skim, tav };
}

type BjSide = { stake: number; winCents: number; label: string | null };

type BjState = {
  roundId: string;
  player: number[];
  dealer: number[]; // during play only the up-card is real to the client
  dealerHidden: boolean;
  playerTotal: number;
  dealerTotal: number | null;
  persona: Persona;
  status: string;
  result?: string | null;
  netCents?: number | null;
  betCents?: number;
  feeCents?: number;
  skimCents?: number;
  tavCents?: number;
  sides?: Record<string, BjSide> | null;
  doubled?: boolean;
};

function bjState(r: { id: string; player: number[]; dealer: number[]; persona: Persona; status: string; result: string | null; netCents: number | null; betCents?: number; feeCents?: number; skimCents?: number; loanCents?: number; tavCents?: number; sides?: Record<string, BjSide> | null; doubled?: boolean }, hideDealer: boolean): BjState {
  const p = handTotal(r.player);
  const d = handTotal(r.dealer);
  return {
    roundId: r.id,
    player: r.player,
    dealer: hideDealer ? r.dealer.slice(0, 1) : r.dealer,
    dealerHidden: hideDealer,
    playerTotal: p.total,
    dealerTotal: hideDealer ? null : d.total,
    persona: r.persona,
    status: r.status,
    result: r.result,
    netCents: r.netCents,
    betCents: r.betCents,
    skimCents: r.skimCents ?? 0,
    // The column is still named loan_cents; under margin rules it stores the
    // funding fee paid at deal time.
    feeCents: r.feeCents ?? r.loanCents ?? 0,
    tavCents: r.tavCents ?? 0,
    sides: r.sides ?? null,
    doubled: r.doubled ?? false,
  };
}

export async function blackjackDeal(input: {
  betCents: number;
  leverage: number;
  dealerId?: string;
  sides?: { pp?: number; t3?: number }; // side-bet stakes in cents — 0/off when absent
}): Promise<{ ok: boolean; error?: string; state?: BjState }> {
  try {
    const u = await requireUser();
    await assertNotSpam(u.id, "game");
    const { bet, lev } = checkBet(input.betCents, input.leverage);
    // Side bets take their own stakes — no leverage, same minimum as any bet.
    const ppBet = Math.round(Number(input.sides?.pp ?? 0));
    const t3Bet = Math.round(Number(input.sides?.t3 ?? 0));
    const ppOn = ppBet > 0;
    const t3On = t3Bet > 0;
    if (!Number.isFinite(ppBet) || !Number.isFinite(t3Bet) || ppBet < 0 || t3Bet < 0) throw new Error("Bad side bet");
    if ((ppOn && ppBet < MIN_BET_CENTS) || (t3On && t3Bet < MIN_BET_CENTS)) throw new Error("Minimum bet is Ɱ 1");
    if (ppBet > MAX_GAME_STAKE_CENTS || t3Bet > MAX_GAME_STAKE_CENTS) throw new Error("Max bet is Ɱ 1 000");
    const sideStake = ppBet + t3Bet;
    if (bet * lev + sideStake > MAX_GAME_WAGER_CENTS) throw new Error("Bet too large");
    const persona = await pickDealer(input.dealerId);
    const deck = shuffledShoe();
    const player = [deck.pop()!, deck.pop()!];
    const dealer = [deck.pop()!, deck.pop()!];
    let state!: BjState;
    await db.transaction(async (tx) => {
      // Same gate as every other game — session pacing, credit line, kill-switch.
      const fee = await stakeGame(tx, u.id, bet, lev, `Blackjack vs ${persona.name}`, "blackjack");
      if (sideStake > 0) await credit(tx, u.id, -sideStake, "game", null, `Blackjack side bets (${[ppOn && "PP", t3On && "21+3"].filter(Boolean).join(", ")})`);
      // Side bets resolve at deal — they pay independently of the 21 outcome.
      const sides: Record<string, BjSide> = {};
      if (ppOn) {
        const w = evalPerfectPairs(player);
        const win = w ? Math.round(ppBet * w.mult) : 0;
        let paid = win;
        if (win) {
          const g = await garnishDebt(tx, u.id, win - ppBet, "Perfect Pairs");
          paid = win - g;
          if (paid > 0) await credit(tx, u.id, paid, "game", null, `Blackjack PP — ${w!.label} ×${w!.mult}${g ? " (debt repaid)" : ""}`);
        }
        sides.pp = { stake: ppBet, winCents: paid, label: w?.label ?? null };
      }
      if (t3On) {
        const w = evalTwentyOnePlusThree(player, dealer[0]);
        const win = w ? Math.round(t3Bet * w.mult) : 0;
        let paid = win;
        if (win) {
          const g = await garnishDebt(tx, u.id, win - t3Bet, "21+3");
          paid = win - g;
          if (paid > 0) await credit(tx, u.id, paid, "game", null, `Blackjack 21+3 — ${w!.label} ×${w!.mult}${g ? " (debt repaid)" : ""}`);
        }
        sides.t3 = { stake: t3Bet, winCents: paid, label: w?.label ?? null };
      }
      const [round] = await tx
        .insert(schema.blackjackRound)
        // loan_cents carries the funding fee so a mid-hand state can show
        // what was already burned — it never becomes debt.
        .values({ userId: u.id, betCents: bet, leverage: lev, deck, player, dealer, persona, sides, loanCents: fee })
        .returning();
      const pNat = isNatural(player);
      const dNat = isNatural(dealer);
      if (pNat || dNat) {
        const result = pNat && dNat ? "push" : pNat ? "blackjack" : "lose";
        const { net, feeCents, skim, tav } = await settleBlackjack(tx, round, result, persona.name);
        state = bjState({ ...round, status: "settled", result, netCents: net, feeCents, skimCents: skim, tavCents: tav }, false);
      } else {
        state = bjState(round, true);
      }
    });
    revalidatePath("/games");
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Deal failed" };
  }
}

// Loads + locks a live round owned by the user; stale hands push-refund and
// report the settled state so the client can show it instead of a dead hand.
async function lockRound(tx: Tx, roundId: string, userId: string) {
  const [r] = await tx.select().from(schema.blackjackRound).where(eq(schema.blackjackRound.id, roundId)).for("update").limit(1);
  if (!r || r.userId !== userId) throw new Error("Round not found");
  if (r.status !== "playing") throw new Error("Hand already settled");
  if (Date.now() - r.createdAt.getTime() > BJ_ROUND_TTL_MS) {
    const { net, feeCents, skim, tav } = await settleBlackjack(tx, r, "push", r.persona.name);
    return { r: { ...r, status: "settled", result: "push", netCents: net, loanCents: feeCents, skimCents: skim, tavCents: tav }, expired: true };
  }
  return { r, expired: false };
}

export async function blackjackHit(input: { roundId: string }): Promise<{ ok: boolean; error?: string; state?: BjState }> {
  try {
    const u = await requireUser();
    let state!: BjState;
    await db.transaction(async (tx) => {
      const { r, expired } = await lockRound(tx, input.roundId, u.id);
      if (expired) { state = bjState(r, false); return; }
      const deck = [...r.deck];
      const card = deck.pop()!;
      const player = [...r.player, card];
      await tx.update(schema.blackjackRound).set({ deck, player }).where(eq(schema.blackjackRound.id, r.id));
      if (handTotal(player).total > 21) {
        const { net, feeCents, skim, tav } = await settleBlackjack(tx, r, "lose", r.persona.name);
        state = bjState({ ...r, player, status: "settled", result: "lose", netCents: net, feeCents, skimCents: skim, tavCents: tav }, false);
      } else {
        state = bjState({ ...r, player }, true);
      }
    });
    revalidatePath("/games");
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Hit failed" };
  }
}

export async function blackjackStand(input: { roundId: string }): Promise<{ ok: boolean; error?: string; state?: BjState }> {
  try {
    const u = await requireUser();
    let state!: BjState;
    await db.transaction(async (tx) => {
      const { r, expired } = await lockRound(tx, input.roundId, u.id);
      if (expired) { state = bjState(r, false); return; }
      const deck = [...r.deck];
      const dealer = [...r.dealer];
      while (handTotal(dealer).total < 17) dealer.push(deck.pop()!);
      const p = handTotal(r.player).total;
      const d = handTotal(dealer).total;
      const result = d > 21 || p > d ? "win" : p === d ? "push" : "lose";
      const { net, feeCents, skim, tav } = await settleBlackjack(tx, r, result, r.persona.name);
      await tx.update(schema.blackjackRound).set({ deck, dealer }).where(eq(schema.blackjackRound.id, r.id));
      state = bjState({ ...r, dealer, status: "settled", result, netCents: net, feeCents, skimCents: skim, tavCents: tav }, false);
    });
    revalidatePath("/games");
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stand failed" };
  }
}

// Double down — first move only: stake another bet + the matching funding fee,
// take exactly one card, then the hand stands.
export async function blackjackDouble(input: { roundId: string }): Promise<{ ok: boolean; error?: string; state?: BjState }> {
  try {
    const u = await requireUser();
    let state!: BjState;
    await db.transaction(async (tx) => {
      const { r, expired } = await lockRound(tx, input.roundId, u.id);
      if (expired) { state = bjState(r, false); return; }
      if (r.player.length !== 2 || r.doubled) throw new Error("Double is a first-move option");
      // The stake cap applies at deal time; a double is part of that hand, not a new wager.
      // The fee scales with the bet, so doubling costs bet + one more fee unit,
      // and the extra stake borrows its own margin leg.
      const [cfg] = await tx.select({ feeBps: schema.casinoConfig.levFeeBps, debtRate: schema.casinoConfig.debtRateBps }).from(schema.casinoConfig).where(eq(schema.casinoConfig.id, "house"));
      const extraFee = levFeeCents(r.betCents, r.leverage, cfg?.feeBps ?? LEV_FEE_BPS);
      await credit(tx, u.id, -r.betCents, "game", null, `Blackjack vs ${r.persona.name} — doubled`);
      if (extraFee > 0) await credit(tx, u.id, -extraFee, "fee", null, `Blackjack vs ${r.persona.name} — double leverage fee`);
      const extraBorrow = r.betCents * (r.leverage - 1);
      if (extraBorrow > 0) await addDebt(tx, u.id, extraBorrow, cfg?.debtRate ?? GAME_DEBT_RATE_BPS, `Blackjack vs ${r.persona.name} — doubled margin Ɱ${(extraBorrow / 100).toFixed(2)}`);
      const deck = [...r.deck];
      const card = deck.pop()!;
      const player = [...r.player, card];
      const doubledRound = { ...r, betCents: r.betCents * 2, loanCents: (r.loanCents ?? 0) + extraFee };
      await tx.update(schema.blackjackRound).set({ deck, player, betCents: doubledRound.betCents, doubled: true }).where(eq(schema.blackjackRound.id, r.id));
      if (handTotal(player).total > 21) {
        const { net, feeCents, skim, tav } = await settleBlackjack(tx, doubledRound, "lose", r.persona.name);
        state = bjState({ ...doubledRound, player, status: "settled", result: "lose", netCents: net, feeCents, skimCents: skim, tavCents: tav }, false);
        return;
      }
      const dealer = [...r.dealer];
      while (handTotal(dealer).total < 17) dealer.push(deck.pop()!);
      const p = handTotal(player).total;
      const d = handTotal(dealer).total;
      const result = d > 21 || p > d ? "win" : p === d ? "push" : "lose";
      const { net, feeCents, skim, tav } = await settleBlackjack(tx, doubledRound, result, r.persona.name);
      await tx.update(schema.blackjackRound).set({ deck, dealer }).where(eq(schema.blackjackRound.id, r.id));
      state = bjState({ ...doubledRound, player, dealer, status: "settled", result, netCents: net, feeCents, skimCents: skim, tavCents: tav }, false);
    });
    revalidatePath("/games");
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Double failed" };
  }
}

// Surrender — first move only: forfeit half the stake and walk away. The
// funding fee was already paid at deal time.
export async function blackjackSurrender(input: { roundId: string }): Promise<{ ok: boolean; error?: string; state?: BjState }> {
  try {
    const u = await requireUser();
    let state!: BjState;
    await db.transaction(async (tx) => {
      const { r, expired } = await lockRound(tx, input.roundId, u.id);
      if (expired) { state = bjState(r, false); return; }
      if (r.player.length !== 2 || r.doubled) throw new Error("Surrender is a first-move option");
      const { net, feeCents, skim, tav } = await settleBlackjack(tx, r, "surrender", r.persona.name);
      state = bjState({ ...r, status: "settled", result: "surrender", netCents: net, feeCents, skimCents: skim, tavCents: tav }, false);
    });
    revalidatePath("/games");
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Surrender failed" };
  }
}

// ---------- dealer personas (admin) ----------

export async function adminUpsertDealer(input: {
  id?: string;
  name: string;
  avatar: string;
  quipWin?: string;
  quipLose?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const name = input.name.trim().slice(0, 40);
    if (!name) throw new Error("Name required");
    // Avatar: an uploaded image (data URI or URL — same rules as market icons)
    // or a short monogram when no picture is set.
    const av = input.avatar.trim();
    const isImg =
      /^data:image\/(jpeg|png|webp);base64,/.test(av) ||
      /^data:image\/svg\+xml[;,]/.test(av) ||
      /^(https?:\/\/|\/)\S+$/.test(av);
    if (av && !isImg && av.length > 8) throw new Error("Avatar must be an image or ≤8 characters");
    if (isImg && av.length > 450_000) throw new Error("Image too large");
    const avatar = isImg ? av : av.slice(0, 8);
    const vals = { name, avatar, quipWin: (input.quipWin ?? "").trim().slice(0, 140), quipLose: (input.quipLose ?? "").trim().slice(0, 140) };
    if (input.id) {
      await db.update(schema.dealerPersona).set(vals).where(eq(schema.dealerPersona.id, input.id));
    } else {
      await db.insert(schema.dealerPersona).values(vals);
    }
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function adminDeleteDealer(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.delete(schema.dealerPersona).where(eq(schema.dealerPersona.id, input.id));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function adminToggleDealer(input: { id: string; active: boolean }): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    await db.update(schema.dealerPersona).set({ active: input.active }).where(eq(schema.dealerPersona.id, input.id));
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}
