import { cache } from "react";
import { unstable_cache } from "next/cache";
import { db, schema } from "@/lib/db";
import { BONUSES, SEASON_LENGTH_MS, SEASON_REWARDS, REFERRAL_EARN_KINDS, REFERRAL_ROYALTY_BPS, REFERRAL_ROYALTY_CAP_CENTS } from "@/lib/rewards";
import { eq, ne, desc, asc, and, gte, ilike, or, sql, inArray, isNull, isNotNull } from "drizzle-orm";
import { yesPrice, multiCoords, multiPrices } from "@/lib/lmsr";
import { accruedDebtCents } from "@/lib/loans";
import { credit, garnishDebt } from "@/lib/tx-market";
import type { MarketStatus } from "@/lib/db/schema";

export type MarketRow = typeof schema.market.$inferSelect;

export function marketYesPrice(m: MarketRow): number {
  return yesPrice(Number(m.qYes), Number(m.qNo), m.b);
}

// Shared-book price map for one group's live options — option id →
// probability. Options are mutually exclusive, so the softmax over live
// coordinates is the probability each option wins. Sums to 1.
export function groupPrices(options: MarketRow[]): Map<string, number> {
  const coords = multiCoords(options.map((o) => ({ qYes: Number(o.qYes), qNo: Number(o.qNo) })));
  const ps = multiPrices(coords, options[0]?.b ?? 300);
  return new Map(options.map((o, i) => [o.id, ps[i]]));
}

// Prices for option rows across any mix of markets — fetches each affected
// group's live siblings in one query, then softmaxes per group. Binary and
// non-live options keep their standalone marketYesPrice.
async function optionPriceMap(markets: MarketRow[]): Promise<Map<string, number>> {
  const parentIds = [
    ...new Set(
      markets
        .filter((m) => m.parentId && m.status === "live")
        .map((m) => m.parentId!)
    ),
  ];
  const out = new Map<string, number>();
  if (!parentIds.length) return out;
  const sibs = await db
    .select()
    .from(schema.market)
    .where(and(inArray(schema.market.parentId, parentIds), eq(schema.market.status, "live")));
  const byParent = new Map<string, MarketRow[]>();
  for (const s of sibs) {
    const list = byParent.get(s.parentId!) ?? [];
    list.push(s);
    byParent.set(s.parentId!, list);
  }
  for (const group of byParent.values()) {
    for (const [id, p] of groupPrices(group)) out.set(id, p);
  }
  return out;
}

// Categories change rarely — shared across every page that renders the tabs.
// 60s data cache; the "categories" tag is busted by any create/rename/reorder/
// delete path in actions.ts.
export const listCategories = unstable_cache(
  async () => {
    const rows = await db
      .select()
      .from(schema.category)
      .orderBy(asc(schema.category.sortIndex), asc(schema.category.createdAt));
    return rows.map((r) => r.name);
  },
  ["list-categories"],
  { revalidate: 60, tags: ["categories"] }
);

// Categories with their market count — for the admin manager (deleting is
// only allowed when a category is empty).
export async function listCategoryRows() {
  const rows = await db
    .select({
      name: schema.category.name,
      markets: sql<number>`(select count(*)::int from ${schema.market} where ${schema.market.category} = ${schema.category.name} and ${schema.market.parentId} is null)`,
    })
    .from(schema.category)
    .orderBy(asc(schema.category.sortIndex), asc(schema.category.createdAt));
  return rows;
}

export async function listMarkets(opts: {
  category?: string;
  q?: string;
  sort?: string;
  status?: MarketStatus;
  includePendingForUser?: string;
  includeOptions?: boolean;
  ids?: string[];
  limit?: number;
}) {
  const { category, q, sort, status = "live" } = opts;
  // Explicit id filter (watchlist) — empty list means "no results", not "all".
  if (opts.ids && opts.ids.length === 0) return [];
  // Only top-level markets — group options surface through their parent.
  // Admin passes includeOptions to reach every resolvable market.
  const conds = opts.includeOptions ? [] : [isNull(schema.market.parentId)];
  if (opts.ids) conds.push(inArray(schema.market.id, opts.ids));
  if (opts.includePendingForUser) {
    conds.push(
      or(
        eq(schema.market.status, status),
        and(eq(schema.market.status, "pending"), eq(schema.market.creatorId, opts.includePendingForUser))
      )!
    );
  } else {
    conds.push(eq(schema.market.status, status));
  }
  if (category && !["all", "trending", "new", "closing", "watching"].includes(category)) {
    conds.push(eq(schema.market.category, category));
  }
  if (q) conds.push(or(ilike(schema.market.question, `%${q}%`), ilike(schema.market.description, `%${q}%`))!);

  const order =
    sort === "new" || category === "new"
      ? [desc(schema.market.createdAt)]
      : sort === "closing"
        ? [asc(schema.market.closesAt)]
        : [desc(schema.market.volumeCents), desc(schema.market.createdAt)];

  return db.select().from(schema.market).where(and(...conds)).orderBy(...order).limit(opts.limit ?? 100);
}

// generateMetadata and the page both hit this — cache() makes it one query.
export const getMarketBySlug = cache(async (slug: string) => {
  const rows = await db
    .select()
    .from(schema.market)
    .where(or(eq(schema.market.slug, slug), sql`${slug} = ANY(${schema.market.aliases})`))
    .limit(1);
  return rows[0] ?? null;
});

export async function getMarketById(id: string) {
  const rows = await db.select().from(schema.market).where(eq(schema.market.id, id)).limit(1);
  return rows[0] ?? null;
}

// Options of a multi-outcome group, in creation order. cache() dedupes the
// generateMetadata + page double-fetch on option pages.
export const getGroupOptions = cache(async (parentId: string) => {
  return db
    .select()
    .from(schema.market)
    .where(eq(schema.market.parentId, parentId))
    .orderBy(asc(schema.market.sortIndex), asc(schema.market.createdAt), asc(schema.market.id));
});

// Batch: children for a set of group ids, grouped in JS. Avoids N+1 on the grid.
export async function getGroupOptionsFor(parentIds: string[]) {
  const map = new Map<string, MarketRow[]>();
  if (parentIds.length === 0) return map;
  const rows = await db
    .select()
    .from(schema.market)
    .where(inArray(schema.market.parentId, parentIds))
    .orderBy(asc(schema.market.sortIndex), asc(schema.market.createdAt), asc(schema.market.id));
  for (const r of rows) {
    const arr = map.get(r.parentId!) ?? [];
    arr.push(r);
    map.set(r.parentId!, arr);
  }
  return map;
}

// Distinct traders across a group's options. Per-option traderCount can't be
// summed — the same user trading three options would count three times.
export async function getGroupTraderCount(optionIds: string[]) {
  if (!optionIds.length) return 0;
  const [r] = await db
    .select({ n: sql<number>`count(distinct ${schema.trade.userId})::int` })
    .from(schema.trade)
    .where(inArray(schema.trade.marketId, optionIds));
  return r?.n ?? 0;
}

// Batched variant for market grids — one query grouped by parent, no N+1.
export async function getGroupTraderCounts(parentIds: string[]) {
  const map = new Map<string, number>();
  if (!parentIds.length) return map;
  const rows = await db
    .select({ parentId: schema.market.parentId, n: sql<number>`count(distinct ${schema.trade.userId})::int` })
    .from(schema.trade)
    .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
    .where(inArray(schema.market.parentId, parentIds))
    .groupBy(schema.market.parentId);
  for (const r of rows) if (r.parentId) map.set(r.parentId, r.n);
  return map;
}

// Latest trades across all options of a group.
export async function getGroupTrades(parentId: string, limit = 25) {
  return db
    .select({
      id: schema.trade.id,
      side: schema.trade.side,
      outcome: schema.trade.outcome,
      shares: schema.trade.shares,
      amountCents: schema.trade.amountCents,
      yesPriceAfter: schema.trade.yesPriceAfter,
      createdAt: schema.trade.createdAt,
      username: schema.user.username,
      name: schema.user.name,
      image: schema.user.image,
      marketId: schema.trade.marketId,
      label: schema.market.label,
    })
    .from(schema.trade)
    .innerJoin(schema.user, eq(schema.trade.userId, schema.user.id))
    .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
    .where(eq(schema.market.parentId, parentId))
    .orderBy(desc(schema.trade.createdAt))
    .limit(limit);
}

// Full-range chart data, decimated to ~240 points in SQL — a canvas/SVG chart
// can't resolve more, and price_point grows without bound otherwise.
// Full history: the stats epoch walls off money counters, not the price path.
export async function getPriceHistory(marketId: string) {
  const rows = await db.execute<{ t: string; p: number }>(sql`
    SELECT created_at AS t, yes_price AS p FROM (
      SELECT yes_price, created_at,
             ROW_NUMBER() OVER (ORDER BY created_at) AS rn,
             COUNT(*) OVER () AS cnt
      FROM price_point
      WHERE market_id = ${marketId}
    ) s
    WHERE rn = 1 OR rn = cnt OR rn % GREATEST(cnt / 240, 1) = 0
    ORDER BY created_at
  `);
  return rows.rows.map((r) => ({ t: new Date(r.t), p: Number(r.p) }));
}

export async function getRecentTrades(marketId: string, limit = 25) {
  return db
    .select({
      id: schema.trade.id,
      side: schema.trade.side,
      outcome: schema.trade.outcome,
      shares: schema.trade.shares,
      amountCents: schema.trade.amountCents,
      yesPriceAfter: schema.trade.yesPriceAfter,
      createdAt: schema.trade.createdAt,
      username: schema.user.username,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.trade)
    .innerJoin(schema.user, eq(schema.trade.userId, schema.user.id))
    .where(eq(schema.trade.marketId, marketId))
    .orderBy(desc(schema.trade.createdAt))
    .limit(limit);
}

export async function getComments(marketId: string, viewerId?: string, viewerIsAdmin = false) {
  const rows = await db
    .select({
      id: schema.comment.id,
      body: schema.comment.body,
      imageUrl: schema.comment.imageUrl,
      createdAt: schema.comment.createdAt,
      userId: schema.comment.userId,
      parentId: schema.comment.parentId,
      hidden: schema.comment.hidden,
      username: schema.user.username,
      name: schema.user.name,
      image: schema.user.image,
      likes: sql<number>`coalesce((select count(*)::int from ${schema.commentVote} where ${schema.commentVote.commentId} = ${schema.comment.id} and ${schema.commentVote.value} = 1), 0)`,
      dislikes: sql<number>`coalesce((select count(*)::int from ${schema.commentVote} where ${schema.commentVote.commentId} = ${schema.comment.id} and ${schema.commentVote.value} = -1), 0)`,
      myVote: viewerId
        ? sql<number>`coalesce((select ${schema.commentVote.value} from ${schema.commentVote} where ${schema.commentVote.commentId} = ${schema.comment.id} and ${schema.commentVote.userId} = ${viewerId}), 0)`
        : sql<number>`0`,
    })
    .from(schema.comment)
    .innerJoin(schema.user, eq(schema.comment.userId, schema.user.id))
    .where(eq(schema.comment.marketId, marketId))
    .orderBy(asc(schema.comment.createdAt))
    .limit(200);
  // Hidden comments are UI-masked only — strip the payload for non-admins so
  // moderated content doesn't ship to every client in the RSC payload.
  if (!viewerIsAdmin)
    for (const r of rows) if (r.hidden) { r.body = ""; r.imageUrl = null; }
  return rows;
}

export async function getUserPosition(marketId: string, userId: string) {
  const rows = await db
    .select()
    .from(schema.position)
    .where(and(eq(schema.position.marketId, marketId), eq(schema.position.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

// The viewer's positions across a set of markets — feeds the group ticket so
// it can show held shares for whichever option is selected.
export type MyPositionEntry = {
  yes: number;
  no: number;
  tpYes: number | null;
  slYes: number | null;
  tpNo: number | null;
  slNo: number | null;
  yesPct: number | null;
  noPct: number | null;
};

export async function getMyPositions(userId: string, marketIds: string[]) {
  if (!marketIds.length) return {} as Record<string, MyPositionEntry>;
  const rows = await db
    .select({
      marketId: schema.position.marketId,
      yes: schema.position.yesShares,
      no: schema.position.noShares,
      tpYes: schema.position.tpYes,
      slYes: schema.position.slYes,
      tpNo: schema.position.tpNo,
      slNo: schema.position.slNo,
      yesPct: schema.position.yesSellPct,
      noPct: schema.position.noSellPct,
    })
    .from(schema.position)
    .where(and(eq(schema.position.userId, userId), inArray(schema.position.marketId, marketIds)));
  return Object.fromEntries(
    rows.map((r) => [
      r.marketId,
      {
        yes: Number(r.yes),
        no: Number(r.no),
        tpYes: r.tpYes == null ? null : Number(r.tpYes),
        slYes: r.slYes == null ? null : Number(r.slYes),
        tpNo: r.tpNo == null ? null : Number(r.tpNo),
        slNo: r.slNo == null ? null : Number(r.slNo),
        yesPct: r.yesPct == null ? null : Number(r.yesPct),
        noPct: r.noPct == null ? null : Number(r.noPct),
      },
    ]),
  );
}

export type PositionRow = {
  market: MarketRow;
  yesShares: number;
  noShares: number;
  py: number; // mark price of YES — group options use the shared book's mark
  valueCents: number;
  debtCents: number;
};

export async function getUserPositions(userId: string): Promise<PositionRow[]> {
  const rows = await db
    .select({ position: schema.position, market: schema.market })
    .from(schema.position)
    .innerJoin(schema.market, eq(schema.position.marketId, schema.market.id))
    .where(eq(schema.position.userId, userId));
  const optPrices = await optionPriceMap(rows.map((r) => r.market));
  return rows
    .map(({ position: p, market: m }) => {
      const y = Number(p.yesShares);
      const n = Number(p.noShares);
      const py = optPrices.get(m.id) ?? marketYesPrice(m);
      // Resolved markets price winning shares at 1, losing at 0. Leveraged
      // positions report equity (value − outstanding loan), floored at zero.
      const grossCents =
        m.status === "resolved"
          ? Math.round((m.outcome === "yes" ? y : n) * 100)
          : Math.round((y * py + n * (1 - py)) * 100);
      return { market: m, yesShares: y, noShares: n, py, valueCents: Math.max(0, grossCents - p.debtCents), debtCents: p.debtCents };
    })
    .filter((r) => r.yesShares > 0.0001 || r.noShares > 0.0001);
}

export async function getUserTrades(userId: string, limit = 50) {
  return db
    .select({
      trade: schema.trade,
      question: schema.market.question,
      slug: schema.market.slug,
    })
    .from(schema.trade)
    .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
    .where(eq(schema.trade.userId, userId))
    .orderBy(desc(schema.trade.createdAt))
    .limit(limit);
}

export async function getUserLedger(userId: string, limit = 50) {
  return db
    .select()
    .from(schema.ledger)
    // 'notify' rows are zero-amount bell items — they'd read as noise in the
    // cash-flow list, so this query skips them; getNotifications serves them.
    .where(and(eq(schema.ledger.userId, userId), ne(schema.ledger.kind, "notify")))
    .orderBy(desc(schema.ledger.createdAt))
    .limit(limit);
}

export async function getJobEarnedLast24h(userId: string, now = Date.now()): Promise<number> {
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${schema.ledger.amountCents}), 0)::bigint` })
    .from(schema.ledger)
    .where(
      and(
        eq(schema.ledger.userId, userId),
        eq(schema.ledger.kind, "job"),
        gte(schema.ledger.createdAt, new Date(now - 24 * 60 * 60_000))
      )
    );
  return Number(row?.cents ?? 0);
}

// cache(): the leaderboard page, getSquads, and ensureSeason can all want the
// board in one request — compute it once per request, not three times.
export const getLeaderboard = cache(async () => {
  // ponytail: JS aggregation; user count is a friend group, not a city.
  const [users, positions] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        name: schema.user.name,
        image: schema.user.image,
        balanceCents: schema.user.balanceCents,
        createdAt: schema.user.createdAt,
        squadId: schema.user.squadId,
      })
      .from(schema.user),
    db
      .select({ position: schema.position, market: schema.market })
      .from(schema.position)
      .innerJoin(schema.market, eq(schema.position.marketId, schema.market.id)),
  ]);

  const optPrices = await optionPriceMap(positions.map((r) => r.market));
  const valueByUser = new Map<string, number>();
  for (const { position: p, market: m } of positions) {
    const py = optPrices.get(m.id) ?? marketYesPrice(m);
    const gross =
      m.status === "resolved"
        ? Number(m.outcome === "yes" ? p.yesShares : p.noShares) * 100
        : (Number(p.yesShares) * py + Number(p.noShares) * (1 - py)) * 100;
    // Leveraged positions count equity only — the loan isn't theirs.
    valueByUser.set(p.userId, (valueByUser.get(p.userId) ?? 0) + Math.max(0, gross - p.debtCents));
  }

  return users
    .map((u) => ({
      ...u,
      portfolioCents: Math.round(valueByUser.get(u.id) ?? 0),
      netWorthCents: u.balanceCents + Math.round(valueByUser.get(u.id) ?? 0),
    }))
    .sort((a, b) => b.netWorthCents - a.netWorthCents);
});

export async function getPendingMarkets() {
  return db
    .select({ market: schema.market, username: schema.user.username })
    .from(schema.market)
    .leftJoin(schema.user, eq(schema.market.creatorId, schema.user.id))
    .where(eq(schema.market.status, "pending"))
    .orderBy(asc(schema.market.createdAt));
}

export async function getAllUsers() {
  return db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      balanceCents: schema.user.balanceCents,
      bannedAt: schema.user.bannedAt,
      commentsBanned: schema.user.commentsBanned,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(asc(schema.user.createdAt));
}

// The bank panel and balance charts restart at this timestamp after an
// economy reset — whale-era rows stay in the ledger for audit but out of
// the displayed stats.
export async function getStatsSince() {
  const [r] = await db
    .select({ statsSince: schema.casinoConfig.statsSince })
    .from(schema.casinoConfig)
    .where(eq(schema.casinoConfig.id, "house"))
    .limit(1);
  return r?.statsSince ?? null;
}

// Admin "inside info" — what the house banked. Game rows are signed: the
// wager row is negative, the payout row positive, so profit = −Σamount.
// Game label is the first word of the memo ("Slots ★ ◆ ◆", "Dice >3 → 5").
// Counts only ledger rows after the stats epoch (casino_config.stats_since).
export async function getHouseStats() {
  const since = await getStatsSince();
  const sinceCond = (kind: string) =>
    since ? and(eq(schema.ledger.kind, kind), gte(schema.ledger.createdAt, since)) : eq(schema.ledger.kind, kind);
  const [perGame, windows, cfg, loanRows, garnishRows, feeRows, debtors] = await Promise.all([
    db
      .select({
        game: sql<string>`split_part(${schema.ledger.memo}, ' ', 1)`,
        rounds: sql<number>`count(*) filter (where ${schema.ledger.amountCents} < 0)::int`,
        wageredCents: sql<number>`coalesce(sum(-${schema.ledger.amountCents}) filter (where ${schema.ledger.amountCents} < 0), 0)::bigint`,
        paidCents: sql<number>`coalesce(sum(${schema.ledger.amountCents}) filter (where ${schema.ledger.amountCents} > 0), 0)::bigint`,
      })
      .from(schema.ledger)
      .where(sinceCond("game"))
      .groupBy(sql`1`),
    db
      .select({
        wageredCents: sql<number>`coalesce(sum(-${schema.ledger.amountCents}) filter (where ${schema.ledger.amountCents} < 0), 0)::bigint`,
        paidCents: sql<number>`coalesce(sum(${schema.ledger.amountCents}) filter (where ${schema.ledger.amountCents} > 0), 0)::bigint`,
        profit24h: sql<number>`coalesce(-sum(${schema.ledger.amountCents}) filter (where ${schema.ledger.createdAt} > now() - interval '24 hours'), 0)::bigint`,
        profit7d: sql<number>`coalesce(-sum(${schema.ledger.amountCents}) filter (where ${schema.ledger.createdAt} > now() - interval '7 days'), 0)::bigint`,
      })
      .from(schema.ledger)
      .where(sinceCond("game")),
    db
      .select({
        tradeMaxLev: schema.casinoConfig.tradeMaxLev,
        levFeeBps: schema.casinoConfig.levFeeBps,
        tradeMaxSpendCents: schema.casinoConfig.tradeMaxSpendCents,
        tradeFeeCents: schema.casinoConfig.tradeFeeCents,
        debtRateBps: schema.casinoConfig.debtRateBps,
        referralRoyaltyBps: schema.casinoConfig.referralRoyaltyBps,
        referralRoyaltyCapCents: schema.casinoConfig.referralRoyaltyCapCents,
        minTradeCents: schema.casinoConfig.minTradeCents,
      })
      .from(schema.casinoConfig)
      .where(eq(schema.casinoConfig.id, "house")),
    // Loans pay the house on the way back: disbursement is a positive row
    // (cash out the door), a cash repayment a negative one, a garnished win a
    // zero row with the amount in the memo ("win repaid XⱮ").
    db
      .select({
        count: sql<number>`count(*)::int`,
        disbursedCents: sql<number>`coalesce(sum(${schema.ledger.amountCents}), 0)::bigint`,
      })
      .from(schema.ledger)
      .where(and(eq(schema.ledger.kind, "loan"), sql`${schema.ledger.amountCents} > 0`, ...(since ? [gte(schema.ledger.createdAt, since)] : []))),
    db
      .select({
        repaidCents: sql<number>`coalesce(sum(-${schema.ledger.amountCents}) filter (where ${schema.ledger.amountCents} < 0), 0)::bigint`,
        garnishedCents: sql<number>`coalesce(sum((regexp_match(${schema.ledger.memo}, 'repaid ([0-9.]+)Ɱ'))[1]::numeric * 100) filter (where ${schema.ledger.amountCents} = 0), 0)::bigint`,
      })
      .from(schema.ledger)
      .where(sinceCond("repay")),
    // Flat order/round fees land under kind "fee": market_id set → trade fee,
    // null → minigame round fee. Funding fees ride the same kind; their memo
    // says "leverage fee" — that's the split key, keep memos consistent.
    db
      .select({
        totalCents: sql<number>`coalesce(sum(-${schema.ledger.amountCents}), 0)::bigint`,
        gameCents: sql<number>`coalesce(sum(-${schema.ledger.amountCents}) filter (where ${schema.ledger.marketId} is null), 0)::bigint`,
        tradeCents: sql<number>`coalesce(sum(-${schema.ledger.amountCents}) filter (where ${schema.ledger.marketId} is not null), 0)::bigint`,
        levGameCents: sql<number>`coalesce(sum(-${schema.ledger.amountCents}) filter (where ${schema.ledger.marketId} is null and ${schema.ledger.memo} ilike '%leverage fee%'), 0)::bigint`,
        levTradeCents: sql<number>`coalesce(sum(-${schema.ledger.amountCents}) filter (where ${schema.ledger.marketId} is not null and ${schema.ledger.memo} ilike '%leverage fee%'), 0)::bigint`,
      })
      .from(schema.ledger)
      .where(sinceCond("fee")),
    db
      .select({ debtCents: schema.user.debtCents, debtRateBps: schema.user.debtRateBps, debtSince: schema.user.debtSince })
      .from(schema.user)
      .where(sql`${schema.user.debtCents} > 0`),
  ]);
  // pg returns bigint fragments as strings — coerce everything before math,
  // otherwise "a" + "b" concatenates and the loans position goes astronomical.
  const w = windows[0] ?? { wageredCents: 0, paidCents: 0, profit24h: 0, profit7d: 0 };
  const loan = loanRows[0] ?? { count: 0, disbursedCents: 0 };
  const rep = garnishRows[0] ?? { repaidCents: 0, garnishedCents: 0 };
  const fees = feeRows[0] ?? { totalCents: 0, gameCents: 0, tradeCents: 0, levGameCents: 0, levTradeCents: 0 };
  const repaidCents = Number(rep.repaidCents) + Number(rep.garnishedCents);
  const outstandingCents = debtors.reduce((s, d) => s + accruedDebtCents(Number(d.debtCents), d.debtRateBps, d.debtSince), 0);
  return {
    games: perGame.map((r) => ({
      ...r,
      wageredCents: Number(r.wageredCents),
      paidCents: Number(r.paidCents),
      profitCents: Number(r.wageredCents) - Number(r.paidCents),
    })),
    wageredCents: Number(w.wageredCents),
    paidCents: Number(w.paidCents),
    profitCents: Number(w.wageredCents) - Number(w.paidCents),
    profit24hCents: Number(w.profit24h),
    profit7dCents: Number(w.profit7d),
    feesCents: {
      total: Number(fees.totalCents),
      game: Number(fees.gameCents),
      trade: Number(fees.tradeCents),
      levGame: Number(fees.levGameCents),
      levTrade: Number(fees.levTradeCents),
    },
    lev: {
      tradeMaxLev: cfg[0]?.tradeMaxLev ?? 10,
      levFeeBps: cfg[0]?.levFeeBps ?? 500,
      tradeMaxSpendCents: cfg[0]?.tradeMaxSpendCents ?? 500000,
    },
    rules: {
      tradeFeeCents: cfg[0]?.tradeFeeCents ?? 100,
      debtRateBps: cfg[0]?.debtRateBps ?? 2000,
      referralRoyaltyBps: cfg[0]?.referralRoyaltyBps ?? 500,
      referralRoyaltyCapCents: cfg[0]?.referralRoyaltyCapCents ?? 200000,
      minTradeCents: cfg[0]?.minTradeCents ?? 1000,
    },
    // Bank position on loans: cash repaid + garnished wins + live debt claims
    // still on the books, minus cash lent out. Debt written off or lost to
    // liquidation simply isn't in outstanding — it shows as a loss.
    loans: {
      count: loan.count,
      disbursedCents: Number(loan.disbursedCents),
      repaidCents,
      outstandingCents,
      positionCents: repaidCents + outstandingCents - Number(loan.disbursedCents),
    },
  };
}

// Timestamped price history for every option of a group — feeds the
// multi-line chart on group pages. One query, grouped in JS.
// Downsampled to ~240 points per market in SQL — charts can't resolve more
// than that anyway, and history grows without bound otherwise.
export async function getGroupHistories(marketIds: string[]) {
  const map = new Map<string, { t: string; p: number }[]>();
  if (marketIds.length === 0) return map;
  const rows = await db.execute<{ market_id: string; p: number; t: string }>(sql`
    SELECT market_id, yes_price AS p, created_at AS t FROM (
      SELECT market_id, yes_price, created_at,
             ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY created_at) AS rn,
             COUNT(*) OVER (PARTITION BY market_id) AS cnt
      FROM price_point
      WHERE market_id IN ${marketIds}
    ) s
    WHERE rn = 1 OR rn = cnt OR rn % GREATEST(cnt / 240, 1) = 0
    ORDER BY market_id, created_at
  `);
  for (const r of rows.rows) {
    const arr = map.get(r.market_id) ?? [];
    arr.push({ t: new Date(r.t).toISOString(), p: Number(r.p) });
    map.set(r.market_id, arr);
  }
  return map;
}

// Latest ~40 price points per market, bounded in SQL — not in JS. Full
// history: the stats epoch walls off money counters, not the price path.
export async function getSparklines(marketIds: string[]) {
  const map = new Map<string, number[]>();
  if (marketIds.length === 0) return map;
  const rows = await db.execute<{ market_id: string; p: number }>(sql`
    SELECT market_id, p FROM (
      SELECT market_id, yes_price AS p,
        ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY created_at DESC) AS rn
      FROM price_point
      WHERE market_id IN ${marketIds}
    ) s WHERE rn <= 40
    ORDER BY market_id, rn DESC`);
  for (const r of rows.rows) {
    const arr = map.get(r.market_id) ?? [];
    arr.push(Number(r.p));
    map.set(r.market_id, arr);
  }
  return map;
}

// Real placed bets on a market — or, for a group, across all its options.
// Used to gate creator self-deletion ("no bets yet").
export async function getMarketBetCount(marketId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.trade)
    .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
    .where(sql`${schema.market.id} = ${marketId} OR ${schema.market.parentId} = ${marketId}`);
  return r?.n ?? 0;
}

export async function getCommentCount(marketIds: string[]) {
  if (marketIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ marketId: schema.comment.marketId, count: sql<number>`count(*)::int` })
    .from(schema.comment)
    .where(inArray(schema.comment.marketId, marketIds))
    .groupBy(schema.comment.marketId);
  return new Map(rows.map((r) => [r.marketId, r.count]));
}

// Latest trades across all markets — feeds the homepage ticker. Ambient data;
// a 15s cache tracks the LiveRefresher cadence and skips a round trip per
// refresh.
export const getGlobalTrades = unstable_cache(
  async (limit = 14) => fetchGlobalTrades(limit),
  ["global-trades"],
  { revalidate: 15 }
);
async function fetchGlobalTrades(limit = 14) {
  return db
    .select({
      id: schema.trade.id,
      side: schema.trade.side,
      outcome: schema.trade.outcome,
      amountCents: schema.trade.amountCents,
      createdAt: schema.trade.createdAt,
      username: schema.user.username,
      name: schema.user.name,
      slug: schema.market.slug,
      question: schema.market.question,
    })
    .from(schema.trade)
    .innerJoin(schema.user, eq(schema.trade.userId, schema.user.id))
    .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
    .orderBy(desc(schema.trade.createdAt))
    .limit(limit);
}

export async function getSiteStats() {
  const [users, vol, trades] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.user),
    db.select({ n: sql<number>`coalesce(sum(${schema.market.volumeCents}),0)::bigint` }).from(schema.market),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.trade),
  ]);
  // pg returns bigint as a string — coerce before the callers do math on it.
  return { users: users[0]?.n ?? 0, volumeCents: Number(vol[0]?.n ?? 0), trades: trades[0]?.n ?? 0 };
}

// Same-category markets excluding the given one — "More markets" rail.
export async function getRelatedMarkets(marketId: string, category: string, limit = 3) {
  return db
    .select()
    .from(schema.market)
    .where(and(eq(schema.market.category, category), eq(schema.market.status, "live"), isNull(schema.market.parentId), sql`${schema.market.id} <> ${marketId}`))
    .orderBy(desc(schema.market.volumeCents))
    .limit(limit);
}

// Rewards state for /rewards: recurring cooldowns, claimed bonuses, and
// milestone eligibility in one round trip per user.
export async function getRewardsState(userId: string) {
  const [claims, [me], [cnts]] = await Promise.all([
    db
      .select({ kind: schema.rewardClaim.kind, amountCents: schema.rewardClaim.amountCents, createdAt: schema.rewardClaim.createdAt })
      .from(schema.rewardClaim)
      .where(eq(schema.rewardClaim.userId, userId))
      .orderBy(desc(schema.rewardClaim.createdAt)),
    db
      .select({ image: schema.user.image, squadId: schema.user.squadId, claimStreak: schema.user.claimStreak, activityStreak: schema.user.activityStreak })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1),
    db
      .select({
        trades: sql<number>`(select count(*)::int from ${schema.trade} where ${schema.trade.userId} = ${userId})`,
        markets: sql<number>`(select count(*)::int from ${schema.market} where ${schema.market.creatorId} = ${userId})`,
        comments: sql<number>`(select count(*)::int from ${schema.comment} where ${schema.comment.userId} = ${userId})`,
        games: sql<number>`(select count(*)::int from ${schema.ledger} where ${schema.ledger.userId} = ${userId} and kind = 'game')`,
        // Win rows carry "won ×n"/"natural 21 ×n" — refunds and side-bet
        // payouts are deliberately excluded.
        gameWins: sql<number>`(select count(*)::int from ${schema.ledger} where ${schema.ledger.userId} = ${userId} and kind = 'game' and amount_cents > 0 and memo ~ '(won|natural)')`,
        watching: sql<number>`(select count(*)::int from ${schema.watchlist} where ${schema.watchlist.userId} = ${userId})`,
        likes: sql<number>`(select count(*)::int from ${schema.marketLike} where ${schema.marketLike.userId} = ${userId})`,
        duels: sql<number>`(select count(*)::int from ${schema.challenge} where ${schema.challenge.creatorId} = ${userId} or ${schema.challenge.opponentId} = ${userId})`,
        sells: sql<number>`(select count(*)::int from ${schema.trade} where ${schema.trade.userId} = ${userId} and ${schema.trade.side} = 'sell')`,
        notes: sql<number>`(select count(*)::int from ${schema.communityNote} where ${schema.communityNote.userId} = ${userId})`,
        votes: sql<number>`(select count(*)::int from ${schema.resolutionVote} where ${schema.resolutionVote.userId} = ${userId})`,
        duelWins: sql<number>`(select count(*)::int from ${schema.challenge} where ${schema.challenge.winnerId} = ${userId})`,
        squadsOwned: sql<number>`(select count(*)::int from ${schema.squad} where ${schema.squad.createdBy} = ${userId})`,
        referrals: sql<number>`(select count(*)::int from ${schema.rewardClaim} where ${schema.rewardClaim.userId} = ${userId} and ${schema.rewardClaim.kind} like 'bonus:referrer:%')`,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId)),
  ]);
  const c = cnts ?? { trades: 0, markets: 0, comments: 0, games: 0, gameWins: 0, watching: 0, likes: 0, duels: 0, sells: 0, notes: 0, votes: 0, duelWins: 0, squadsOwned: 0, referrals: 0 };

  // Referral royalties: each bonus:referrer:<refereeId> row earns 5% of that
  // referee's lifetime earned income; bonus:royalty:<refereeId> rows track how
  // much of it has already been paid out.
  const refIds = claims.filter((r) => r.kind.startsWith("bonus:referrer:")).map((r) => r.kind.slice("bonus:referrer:".length));
  const paidMap = new Map(
    claims.filter((r) => r.kind.startsWith("bonus:royalty:")).map((r) => [r.kind.slice("bonus:royalty:".length), r.amountCents])
  );
  let referrals: { id: string; username: string | null; name: string | null; earnedCents: number; royaltyCents: number; paidCents: number }[] = [];
  if (refIds.length) {
    // Royalties count post-epoch earnings only — whale-era churn shouldn't
    // mint referral money. Rate/cap are admin-tunable on the config row.
    const [refCfg] = await db
      .select({ bps: schema.casinoConfig.referralRoyaltyBps, cap: schema.casinoConfig.referralRoyaltyCapCents })
      .from(schema.casinoConfig)
      .where(eq(schema.casinoConfig.id, "house"));
    const royBps = refCfg?.bps ?? REFERRAL_ROYALTY_BPS;
    const royCap = refCfg?.cap ?? REFERRAL_ROYALTY_CAP_CENTS;
    const statsSince = await getStatsSince();
    const [earned, names] = await Promise.all([
      db
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
      db
        .select({ id: schema.user.id, username: schema.user.username, name: schema.user.name })
        .from(schema.user)
        .where(inArray(schema.user.id, refIds)),
    ]);
    const earnedMap = new Map(earned.map((e) => [e.userId, Number(e.cents)]));
    const nameMap = new Map(names.map((n) => [n.id, n]));
    referrals = refIds.map((id) => {
      const e = earnedMap.get(id) ?? 0;
      return {
        id,
        username: nameMap.get(id)?.username ?? null,
        name: nameMap.get(id)?.name ?? null,
        earnedCents: e,
        royaltyCents: Math.min(Math.floor((e * royBps) / 10_000), royCap),
        paidCents: paidMap.get(id) ?? 0,
      };
    });
  }
  const royaltyDueCents = referrals.reduce((s, r) => s + Math.max(0, r.royaltyCents - r.paidCents), 0);

  return {
    referrals,
    royaltyDueCents,
    claimed: new Set(claims.map((c2) => c2.kind)),
    lastWeekly: claims.find((c2) => c2.kind === "weekly")?.createdAt ?? null,
    lastAd: claims.find((c2) => c2.kind === "ad")?.createdAt ?? null,
    eligible: {
      bet: c.trades > 0,
      market: c.markets > 0,
      comment: c.comments > 0,
      game: c.games > 0,
      win: c.gameWins > 0,
      avatar: !!me?.image,
      watchlist: c.watching > 0,
      like: c.likes > 0,
      duel: c.duels > 0,
      squad: !!me?.squadId,
      tenTrades: c.trades >= 10,
      streak7: (me?.claimStreak ?? 0) >= 7,
      sell: c.sells > 0,
      note: c.notes > 0,
      vote: c.votes > 0,
      duelWin: c.duelWins > 0,
      squadOwner: c.squadsOwned > 0,
      referrer: c.referrals > 0,
      fiftyTrades: c.trades >= 50,
      active7: (me?.activityStreak ?? 0) >= 7,
    },
  };
}

// ---------- social ----------

// Public profile bundle for /u/[username] — stats + open positions + markets
// created. Leaderboard rank comes from the same net-worth math.
export async function getPublicProfile(username: string) {
  const [u] = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
      role: schema.user.role,
      balanceCents: schema.user.balanceCents,
      createdAt: schema.user.createdAt,
      squadId: schema.user.squadId,
      bannedAt: schema.user.bannedAt,
      notifResolve: schema.user.notifResolve,
      notifClosing: schema.user.notifClosing,
    })
    .from(schema.user)
    .where(sql`lower(${schema.user.username}) = lower(${username})`)
    .limit(1);
  if (!u) return null;

  // One wave after the user row — squad, stats, positions, created markets,
  // leaderboard rank, faucet income, and game history are all independent.
  const statsSince = await getStatsSince();
  const [[sq], [stats], positions, created, lb, [faucet], games] = await Promise.all([
    u.squadId
      ? db.select({ name: schema.squad.name }).from(schema.squad).where(eq(schema.squad.id, u.squadId)).limit(1)
      : Promise.resolve([null] as { name: string }[] | null[]),
    db
      .select({
        trades: sql<number>`(select count(*)::int from ${schema.trade} where ${schema.trade.userId} = ${u.id})`,
        markets: sql<number>`(select count(*)::int from ${schema.market} where ${schema.market.creatorId} = ${u.id} and ${schema.market.parentId} is null)`,
        comments: sql<number>`(select count(*)::int from ${schema.comment} where ${schema.comment.userId} = ${u.id})`,
        duels: sql<number>`(select count(*)::int from ${schema.challenge} where ${schema.challenge.creatorId} = ${u.id} or ${schema.challenge.opponentId} = ${u.id})`,
      })
      .from(schema.user)
      .where(eq(schema.user.id, u.id)),
    getUserPositions(u.id),
    // Top-level markets only — group options share creatorId but collapse into
    // their parent's row here. No cap: profiles should list everything created.
    db
      .select()
      .from(schema.market)
      .where(and(eq(schema.market.creatorId, u.id), isNull(schema.market.parentId)))
      .orderBy(desc(schema.market.createdAt)),
    getLeaderboard(),
    // Play PnL = net worth minus faucet income — isolates trading/game skill.
    // Both sides are epoch-bound: pre-reset free money and pre-reset game
    // history are stats-dead, like everywhere else.
    db
      .select({ cents: sql<number>`coalesce(sum(${schema.ledger.amountCents}),0)::bigint` })
      .from(schema.ledger)
      .where(
        and(
          eq(schema.ledger.userId, u.id),
          sql`${schema.ledger.amountCents} > 0`,
          inArray(schema.ledger.kind, ["signup", "claim", "weekly", "ad", "bonus", "grant", "job"]),
          statsSince ? gte(schema.ledger.createdAt, statsSince) : undefined
        )
      ),
    db
      .select({ id: schema.ledger.id, amountCents: schema.ledger.amountCents, memo: schema.ledger.memo, createdAt: schema.ledger.createdAt })
      .from(schema.ledger)
      .where(
        and(
          eq(schema.ledger.userId, u.id),
          eq(schema.ledger.kind, "game"),
          statsSince ? gte(schema.ledger.createdAt, statsSince) : undefined
        )
      )
      .orderBy(desc(schema.ledger.createdAt))
      .limit(12),
  ]);

  const netWorthCents = u.balanceCents + positions.reduce((s, p) => s + p.valueCents, 0);
  const rank = lb.findIndex((r) => r.id === u.id) + 1;

  return {
    user: u,
    stats: stats ?? { trades: 0, markets: 0, comments: 0, duels: 0 },
    positions,
    created,
    netWorthCents,
    rank,
    playPnlCents: netWorthCents - Number(faucet?.cents ?? 0),
    games,
    squadName: sq?.name ?? null,
  };
}

// Credit-side ledger events the user didn't trigger — feeds the header bell.
const NOTIF_KINDS = ["payout", "refund", "liq", "grant", "bonus", "notify"];

export async function getNotifications(userId: string, limit = 10) {
  return db
    .select({
      id: schema.ledger.id,
      kind: schema.ledger.kind,
      amountCents: schema.ledger.amountCents,
      memo: schema.ledger.memo,
      createdAt: schema.ledger.createdAt,
      slug: schema.market.slug,
    })
    .from(schema.ledger)
    .leftJoin(schema.market, eq(schema.ledger.marketId, schema.market.id))
    .where(and(eq(schema.ledger.userId, userId), inArray(schema.ledger.kind, NOTIF_KINDS)))
    .orderBy(desc(schema.ledger.createdAt))
    .limit(limit);
}

// ---------- retention: weekly seasons ----------

// Idempotent rollover: whoever loads the leaderboard after endsAt settles the
// season. The guarded UPDATE (settledAt IS NULL) makes concurrent renders safe —
// the loser sees zero affected rows and re-reads the new live season instead.
export async function ensureSeason() {
  const [live] = await db
    .select()
    .from(schema.season)
    .where(isNull(schema.season.settledAt))
    .orderBy(desc(schema.season.index))
    .limit(1);
  if (live && live.endsAt.getTime() > Date.now()) return live;

  const board = live ? await getLeaderboard() : [];
  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      let nextIndex = 1;
      if (live) {
        const [locked] = await tx
          .update(schema.season)
          .set({ settledAt: now })
          .where(and(eq(schema.season.id, live.id), isNull(schema.season.settledAt)))
          .returning({ id: schema.season.id });
        if (!locked) {
          const [fresh] = await tx
            .select()
            .from(schema.season)
            .where(isNull(schema.season.settledAt))
            .orderBy(desc(schema.season.index))
            .limit(1);
          if (fresh) return fresh;
        } else {
          nextIndex = live.index + 1;
          for (const [i, row] of board.slice(0, SEASON_REWARDS.length).entries()) {
            const reward = SEASON_REWARDS[i] ?? 0;
            await tx.insert(schema.seasonResult).values({
              seasonId: live.id,
              userId: row.id,
              rank: i + 1,
              netWorthCents: row.netWorthCents,
              rewardCents: reward,
            });
            if (reward > 0) {
              const skim = Math.min(reward, await garnishDebt(tx, row.id, reward, `Season ${live.index}`));
              await credit(tx, row.id, reward - skim, "bonus", null, `Season ${live.index} · #${i + 1}${skim > 0 ? " (debt repaid)" : ""}`);
            }
          }
        }
      }
      const [next] = await tx
        .insert(schema.season)
        .values({ index: nextIndex, startsAt: now, endsAt: new Date(now.getTime() + SEASON_LENGTH_MS) })
        .returning();
      return next;
    });
  } catch {
    // season.index is unique — a concurrent rollover that won the race surfaces
    // as a conflict here; just read the live row they created.
    const [fresh] = await db
      .select()
      .from(schema.season)
      .where(isNull(schema.season.settledAt))
      .orderBy(desc(schema.season.index))
      .limit(1);
    if (fresh) return fresh;
    throw new Error("Season rollover failed");
  }
}

// Leverage configuration — the market-order cap, funding-fee rate, and
// spend cap. Read by the market ticket and the admin panel so the UI shows
// exactly what the server will accept.
export async function getLevConfig(): Promise<{
  tradeMaxLev: number;
  levFeeBps: number;
  tradeMaxSpendCents: number;
}> {
  const [cfg] = await db
    .select({
      tradeMaxLev: schema.casinoConfig.tradeMaxLev,
      levFeeBps: schema.casinoConfig.levFeeBps,
      tradeMaxSpendCents: schema.casinoConfig.tradeMaxSpendCents,
    })
    .from(schema.casinoConfig)
    .where(eq(schema.casinoConfig.id, "house"))
    .limit(1);
  return {
    tradeMaxLev: cfg?.tradeMaxLev ?? 10,
    levFeeBps: cfg?.levFeeBps ?? 500,
    tradeMaxSpendCents: cfg?.tradeMaxSpendCents ?? 500000,
  };
}

export async function getSeasonHistory(limit = 4) {
  const seasons = await db
    .select()
    .from(schema.season)
    .where(isNotNull(schema.season.settledAt))
    .orderBy(desc(schema.season.index))
    .limit(limit);
  if (seasons.length === 0) return [];
  const results = await db
    .select({
      seasonId: schema.seasonResult.seasonId,
      rank: schema.seasonResult.rank,
      netWorthCents: schema.seasonResult.netWorthCents,
      rewardCents: schema.seasonResult.rewardCents,
      username: schema.user.username,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.seasonResult)
    .innerJoin(schema.user, eq(schema.seasonResult.userId, schema.user.id))
    .where(inArray(schema.seasonResult.seasonId, seasons.map((s) => s.id)))
    .orderBy(asc(schema.seasonResult.rank));
  return seasons.map((s) => ({ season: s, podium: results.filter((r) => r.seasonId === s.id) }));
}

// ---------- achievements (derived, no dedicated table) ----------

export type Achievement = { key: string; unlocked: boolean; progress: number };

export async function getAchievements(userId: string): Promise<Achievement[]> {
  const [u] = await db
    .select({ claimStreak: schema.user.claimStreak, balanceCents: schema.user.balanceCents })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!u) return [];

  const [claims, counts, podium, positions] = await Promise.all([
    db.select({ kind: schema.rewardClaim.kind }).from(schema.rewardClaim).where(eq(schema.rewardClaim.userId, userId)),
    db
      .select({
        trades: sql<number>`(select count(*)::int from ${schema.trade} where ${schema.trade.userId} = ${userId})`,
        markets: sql<number>`(select count(*)::int from ${schema.market} where ${schema.market.creatorId} = ${userId})`,
        comments: sql<number>`(select count(*)::int from ${schema.comment} where ${schema.comment.userId} = ${userId})`,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId)),
    db
      .select({ id: schema.seasonResult.id })
      .from(schema.seasonResult)
      .where(eq(schema.seasonResult.userId, userId))
      .limit(1),
    getUserPositions(userId),
  ]);
  const netWorth = u.balanceCents + positions.reduce((s, p) => s + p.valueCents, 0);
  const claimed = new Set(claims.map((c) => c.kind));
  const c = counts[0] ?? { trades: 0, markets: 0, comments: 0 };
  const done = (cur: number, need: number) => ({ unlocked: cur >= need, progress: Math.min(1, cur / need) });

  return [
    ...BONUSES.map((b) => ({ key: b.key, unlocked: claimed.has(`bonus:${b.key}`), progress: claimed.has(`bonus:${b.key}`) ? 1 : 0 })),
    { key: "streak_7", ...done(u.claimStreak, 7) },
    { key: "trades_10", ...done(c.trades, 10) },
    { key: "trades_50", ...done(c.trades, 50) },
    { key: "markets_5", ...done(c.markets, 5) },
    { key: "comments_10", ...done(c.comments, 10) },
    { key: "season_podium", unlocked: podium.length > 0, progress: podium.length > 0 ? 1 : 0 },
    { key: "whale", ...done(netWorth, 1_000_000) },
  ];
}

// ---------- watchlist + resolve queue ----------

export async function getWatchlistIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ marketId: schema.watchlist.marketId })
    .from(schema.watchlist)
    .where(eq(schema.watchlist.userId, userId));
  return rows.map((r) => r.marketId);
}

// ---------- market likes ----------

export async function getLikedIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ marketId: schema.marketLike.marketId })
    .from(schema.marketLike)
    .where(eq(schema.marketLike.userId, userId));
  return rows.map((r) => r.marketId);
}

// Batch: like counts for a set of market ids — one GROUP BY, no N+1.
export async function getLikeCounts(marketIds: string[]) {
  const map = new Map<string, number>();
  if (!marketIds.length) return map;
  const rows = await db
    .select({ marketId: schema.marketLike.marketId, n: sql<number>`count(*)::int` })
    .from(schema.marketLike)
    .where(inArray(schema.marketLike.marketId, marketIds))
    .groupBy(schema.marketLike.marketId);
  for (const r of rows) map.set(r.marketId, r.n);
  return map;
}

// Live markets past their close time — the "ready to resolve" queue.
export async function getExpiredLive(limit = 5) {
  return db
    .select()
    .from(schema.market)
    .where(and(eq(schema.market.status, "live"), isNull(schema.market.parentId), sql`${schema.market.closesAt} < now()`))
    .orderBy(asc(schema.market.closesAt))
    .limit(limit);
}

export async function isLiked(userId: string, marketId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: schema.marketLike.userId })
    .from(schema.marketLike)
    .where(and(eq(schema.marketLike.userId, userId), eq(schema.marketLike.marketId, marketId)))
    .limit(1);
  return rows.length > 0;
}

// Watched live markets entering their final 24h — inserts a "Closes soon"
// notify row per (user, market) once. Check-then-insert: a rare concurrent
// duplicate is cosmetic, and dedupe matches the memo prefix per market.
export async function maybeNotifyClosing(userId: string) {
  const [me] = await db
    .select({ notifClosing: schema.user.notifClosing })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!me?.notifClosing) return;
  const soon = await db
    .select({ id: schema.market.id, question: schema.market.question })
    .from(schema.watchlist)
    .innerJoin(schema.market, eq(schema.watchlist.marketId, schema.market.id))
    .where(
      and(
        eq(schema.watchlist.userId, userId),
        eq(schema.market.status, "live"),
        sql`${schema.market.closesAt} > now()`,
        sql`${schema.market.closesAt} < now() + interval '24 hours'`
      )
    )
    .limit(20);
  if (soon.length === 0) return;

  const sent = await db
    .select({ marketId: schema.ledger.marketId })
    .from(schema.ledger)
    .where(
      and(
        eq(schema.ledger.userId, userId),
        eq(schema.ledger.kind, "notify"),
        inArray(schema.ledger.marketId, soon.map((m) => m.id)),
        sql`${schema.ledger.memo} like 'Closes soon%'`
      )
    );
  const done = new Set(sent.map((r) => r.marketId));
  const missing = soon.filter((m) => !done.has(m.id));
  if (missing.length === 0) return;

  const [u] = await db
    .select({ balanceCents: schema.user.balanceCents })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!u) return;
  await db.insert(schema.ledger).values(
    missing.map((m) => ({
      userId,
      amountCents: 0,
      balanceAfterCents: u.balanceCents,
      kind: "notify" as const,
      marketId: m.id,
      memo: `Closes soon: ${m.question.slice(0, 80)}`,
    }))
  );
}

// Proposal + vote tally for the community-resolution card on market pages.
export async function getResolutionState(marketId: string, userId?: string) {
  const votes = await db
    .select({ vote: schema.resolutionVote.vote, n: sql<number>`count(*)::int` })
    .from(schema.resolutionVote)
    .where(eq(schema.resolutionVote.marketId, marketId))
    .groupBy(schema.resolutionVote.vote);
  const [proposer] = await db
    .select({ username: schema.user.username })
    .from(schema.market)
    .leftJoin(schema.user, eq(schema.market.proposedById, schema.user.id))
    .where(eq(schema.market.id, marketId))
    .limit(1);
  let myVote: string | null = null;
  if (userId) {
    const [v] = await db
      .select({ vote: schema.resolutionVote.vote })
      .from(schema.resolutionVote)
      .where(and(eq(schema.resolutionVote.marketId, marketId), eq(schema.resolutionVote.userId, userId)))
      .limit(1);
    myVote = v?.vote ?? null;
  }
  return {
    confirms: votes.find((v) => v.vote === "confirm")?.n ?? 0,
    disputes: votes.find((v) => v.vote === "dispute")?.n ?? 0,
    myVote,
    proposer: proposer?.username ?? null,
  };
}

// Same data as getResolutionState but batched for a set of markets — used by
// group pages where each option has its own community-resolution state.
export async function getResolutionStates(marketIds: string[], userId?: string) {
  const map = new Map<string, { confirms: number; disputes: number; myVote: string | null; proposer: string | null }>();
  if (marketIds.length === 0) return map;
  const votes = await db
    .select({ marketId: schema.resolutionVote.marketId, vote: schema.resolutionVote.vote, n: sql<number>`count(*)::int` })
    .from(schema.resolutionVote)
    .where(inArray(schema.resolutionVote.marketId, marketIds))
    .groupBy(schema.resolutionVote.marketId, schema.resolutionVote.vote);
  const proposers = await db
    .select({ id: schema.market.id, username: schema.user.username })
    .from(schema.market)
    .leftJoin(schema.user, eq(schema.market.proposedById, schema.user.id))
    .where(inArray(schema.market.id, marketIds));
  let mine: { marketId: string; vote: string }[] = [];
  if (userId) {
    mine = await db
      .select({ marketId: schema.resolutionVote.marketId, vote: schema.resolutionVote.vote })
      .from(schema.resolutionVote)
      .where(and(inArray(schema.resolutionVote.marketId, marketIds), eq(schema.resolutionVote.userId, userId)));
  }
  for (const id of marketIds) {
    const rows = votes.filter((v) => v.marketId === id);
    map.set(id, {
      confirms: rows.find((v) => v.vote === "confirm")?.n ?? 0,
      disputes: rows.find((v) => v.vote === "dispute")?.n ?? 0,
      myVote: mine.find((v) => v.marketId === id)?.vote ?? null,
      proposer: proposers.find((p) => p.id === id)?.username ?? null,
    });
  }
  return map;
}

// Community notes for a market — resolvers get every note (with publish
// flags); the public card only ever asks for published ones.
export async function getCommunityNotes(marketId: string, opts: { publishedOnly?: boolean } = {}) {
  return db
    .select({
      id: schema.communityNote.id,
      body: schema.communityNote.body,
      stance: schema.communityNote.stance,
      published: schema.communityNote.published,
      createdAt: schema.communityNote.createdAt,
      userId: schema.communityNote.userId,
      username: schema.user.username,
      userImage: schema.user.image,
    })
    .from(schema.communityNote)
    .leftJoin(schema.user, eq(schema.communityNote.userId, schema.user.id))
    .where(
      and(
        eq(schema.communityNote.marketId, marketId),
        opts.publishedOnly ? eq(schema.communityNote.published, true) : undefined
      )
    )
    .orderBy(desc(schema.communityNote.createdAt));
}

// Notes for a set of markets (group options) batched into a map — pass
// publishedOnly for the public card; resolvers get everything.
export async function getNotesFor(marketIds: string[], opts: { publishedOnly?: boolean } = {}) {
  const map = new Map<string, { id: string; body: string; stance: string | null; published: boolean; userId: string; username: string | null; userImage: string | null; createdAt: Date }[]>();
  if (marketIds.length === 0) return map;
  const rows = await db
    .select({
      id: schema.communityNote.id,
      marketId: schema.communityNote.marketId,
      body: schema.communityNote.body,
      stance: schema.communityNote.stance,
      published: schema.communityNote.published,
      userId: schema.communityNote.userId,
      createdAt: schema.communityNote.createdAt,
      username: schema.user.username,
      userImage: schema.user.image,
    })
    .from(schema.communityNote)
    .leftJoin(schema.user, eq(schema.communityNote.userId, schema.user.id))
    .where(
      and(
        inArray(schema.communityNote.marketId, marketIds),
        opts.publishedOnly ? eq(schema.communityNote.published, true) : undefined
      )
    )
    .orderBy(desc(schema.communityNote.createdAt));
  for (const r of rows) {
    const arr = map.get(r.marketId) ?? [];
    arr.push(r);
    map.set(r.marketId, arr);
  }
  return map;
}

// Total note count per market — admin list + the >5 admin-resolution gate.
export async function getNoteCounts(marketIds: string[]) {
  const map = new Map<string, number>();
  if (marketIds.length === 0) return map;
  const rows = await db
    .select({ marketId: schema.communityNote.marketId, n: sql<number>`count(*)::int` })
    .from(schema.communityNote)
    .where(inArray(schema.communityNote.marketId, marketIds))
    .groupBy(schema.communityNote.marketId);
  for (const r of rows) map.set(r.marketId, r.n);
  return map;
}

// Duels involving this user — opponent/creator names joined for display.
// Everyone but the requester — the site is small enough that a full list
// beats a search box for picking a duel opponent.
export async function listDuelOpponents(userId: string) {
  return db
    .select({ id: schema.user.id, username: schema.user.username, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(and(sql`${schema.user.id} <> ${userId}`, isNull(schema.user.bannedAt)))
    .orderBy(asc(schema.user.username));
}

export async function getDuels(userId: string) {
  const rows = await db
    .select({
      duel: schema.challenge,
      creatorName: sql<string>`(select username from ${schema.user} u2 where u2.id = ${schema.challenge.creatorId})`,
      opponentName: sql<string>`(select username from ${schema.user} u3 where u3.id = ${schema.challenge.opponentId})`,
      winnerName: sql<string | null>`(select username from ${schema.user} u4 where u4.id = ${schema.challenge.winnerId})`,
    })
    .from(schema.challenge)
    .where(sql`${schema.challenge.creatorId} = ${userId} OR ${schema.challenge.opponentId} = ${userId}`)
    .orderBy(desc(schema.challenge.createdAt))
    .limit(30);
  return rows;
}

// Single duel for the arena route — scoped to the participant so a deep link
// can't peek at other people's duels.
export async function getDuel(userId: string, duelId: string) {
  const rows = await db
    .select({
      duel: schema.challenge,
      creatorName: sql<string>`(select username from ${schema.user} u2 where u2.id = ${schema.challenge.creatorId})`,
      opponentName: sql<string>`(select username from ${schema.user} u3 where u3.id = ${schema.challenge.opponentId})`,
      winnerName: sql<string | null>`(select username from ${schema.user} u4 where u4.id = ${schema.challenge.winnerId})`,
    })
    .from(schema.challenge)
    .where(
      and(
        eq(schema.challenge.id, duelId),
        or(eq(schema.challenge.creatorId, userId), eq(schema.challenge.opponentId, userId))
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

// Duels needing admin eyes: disputed ones, plus accepted duels where neither
// side has proposed a winner — without this they'd sit invisible forever.
export async function getDisputedDuels() {
  return db
    .select({
      duel: schema.challenge,
      creatorName: sql<string>`(select username from ${schema.user} u2 where u2.id = ${schema.challenge.creatorId})`,
      opponentName: sql<string>`(select username from ${schema.user} u3 where u3.id = ${schema.challenge.opponentId})`,
    })
    .from(schema.challenge)
    .where(
      or(
        eq(schema.challenge.status, "disputed"),
        and(eq(schema.challenge.status, "accepted"), isNull(schema.challenge.pendingWinnerId))
      )
    )
    .orderBy(desc(schema.challenge.createdAt))
    .limit(20);
}

// Squad standings — aggregate the leaderboard rows by squad.
export async function getSquads() {
  const squads = await db.select().from(schema.squad);
  const board = await getLeaderboard();
  return squads
    .map((s) => {
      const members = board.filter((u) => u.squadId === s.id);
      return {
        id: s.id,
        name: s.name,
        memberCount: members.length,
        netWorthCents: members.reduce((sum, u) => sum + u.netWorthCents, 0),
        members: members.map((m) => m.username ?? m.name),
      };
    })
    .filter((s) => s.memberCount > 0)
    .sort((a, b) => b.netWorthCents - a.netWorthCents);
}

// The squad hub: members with balances + net worth, the pot, outstanding
// loans, and a merged activity feed of member trades for the page sidebar.
export async function getSquadHub(squadId: string, viewerId: string) {
  const [sq] = await db.select().from(schema.squad).where(eq(schema.squad.id, squadId)).limit(1);
  if (!sq) return null;
  const members = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      name: schema.user.name,
      image: schema.user.image,
      balanceCents: schema.user.balanceCents,
      squadDebtCents: schema.user.squadDebtCents,
      squadRole: schema.user.squadRole,
    })
    .from(schema.user)
    .where(eq(schema.user.squadId, squadId));
  const board = await getLeaderboard();
  const worth = new Map(board.map((u) => [u.id, u.netWorthCents]));
  const ids = members.map((m) => m.id);
  const activity = ids.length
    ? await db
        .select({
          id: schema.trade.id,
          userId: schema.trade.userId,
          username: schema.user.username,
          name: schema.user.name,
          image: schema.user.image,
          side: schema.trade.side,
          outcome: schema.trade.outcome,
          shares: schema.trade.shares,
          amountCents: schema.trade.amountCents,
          createdAt: schema.trade.createdAt,
          marketId: schema.market.id,
          question: schema.market.question,
          slug: schema.market.slug,
        })
        .from(schema.trade)
        .innerJoin(schema.user, eq(schema.trade.userId, schema.user.id))
        .innerJoin(schema.market, eq(schema.trade.marketId, schema.market.id))
        .where(inArray(schema.trade.userId, ids))
        .orderBy(desc(schema.trade.createdAt))
        .limit(20)
    : [];
  return {
    squad: sq,
    members: members
      .map((m) => ({ ...m, netWorthCents: worth.get(m.id) ?? m.balanceCents, isMe: m.id === viewerId }))
      .sort((a, b) => b.netWorthCents - a.netWorthCents),
    activity,
  };
}

// Inviter details for the ?ref= login card — name + avatar only.
export async function getInviter(username: string) {
  const rows = await db
    .select({ username: schema.user.username, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(sql`lower(${schema.user.username}) = lower(${username})`)
    .limit(1);
  return rows[0] ?? null;
}

// Pending squad invites addressed to a user — shown on their own profile.
export async function getSquadInvites(userId: string) {
  return db
    .select({
      id: schema.squadInvite.id,
      squadName: schema.squad.name,
      inviterName: schema.user.username,
      createdAt: schema.squadInvite.createdAt,
    })
    .from(schema.squadInvite)
    .innerJoin(schema.squad, eq(schema.squadInvite.squadId, schema.squad.id))
    .innerJoin(schema.user, eq(schema.squadInvite.inviterId, schema.user.id))
    .where(eq(schema.squadInvite.inviteeId, userId))
    .orderBy(desc(schema.squadInvite.createdAt));
}

// Largest open positions on a market — join user for display.
export async function getTopHolders(marketId: string, limit = 8) {
  return db
    .select({
      username: schema.user.username,
      name: schema.user.name,
      image: schema.user.image,
      yesShares: schema.position.yesShares,
      noShares: schema.position.noShares,
    })
    .from(schema.position)
    .innerJoin(schema.user, eq(schema.position.userId, schema.user.id))
    .where(
      and(
        eq(schema.position.marketId, marketId),
        sql`(${schema.position.yesShares}::numeric > 0.01 OR ${schema.position.noShares}::numeric > 0.01)`
      )
    )
    .orderBy(sql`GREATEST(${schema.position.yesShares}::numeric, ${schema.position.noShares}::numeric) DESC`)
    .limit(limit);
}

// Largest open positions across a group's options — one row per trader, with
// every option they hold attached so the row can expand. Feeds the Holders
// tab on group markets.
export async function getGroupHolders(optionIds: string[], limit = 12) {
  if (!optionIds.length) return [];
  const rows = await db
    .select({
      userId: schema.position.userId,
      username: schema.user.username,
      name: schema.user.name,
      image: schema.user.image,
      marketId: schema.position.marketId,
      yesShares: schema.position.yesShares,
      noShares: schema.position.noShares,
    })
    .from(schema.position)
    .innerJoin(schema.user, eq(schema.position.userId, schema.user.id))
    .where(
      and(
        inArray(schema.position.marketId, optionIds),
        sql`(${schema.position.yesShares}::numeric > 0.01 OR ${schema.position.noShares}::numeric > 0.01)`
      )
    );
  type Holding = { marketId: string; side: "yes" | "no"; shares: number };
  const best = new Map<
    string,
    { username: string | null; name: string; image: string | null; marketId: string; side: "yes" | "no"; shares: number; holdings: Holding[] }
  >();
  for (const r of rows) {
    const key = r.userId;
    const entry = best.get(key) ?? {
      username: r.username,
      name: r.name,
      image: r.image,
      marketId: r.marketId,
      side: "yes" as const,
      shares: 0,
      holdings: [],
    };
    const yes = Number(r.yesShares);
    const no = Number(r.noShares);
    if (yes > 0.01) entry.holdings.push({ marketId: r.marketId, side: "yes", shares: yes });
    if (no > 0.01) entry.holdings.push({ marketId: r.marketId, side: "no", shares: no });
    best.set(key, entry);
  }
  for (const h of best.values()) {
    h.holdings.sort((a, b) => b.shares - a.shares);
    const top = h.holdings[0];
    h.marketId = top.marketId;
    h.side = top.side;
    h.shares = top.shares;
  }
  return [...best.values()].sort((a, b) => b.shares - a.shares).slice(0, limit);
}

// Public creator/last-resolver identity for the market context card.
export async function getUserPublic(id: string | null | undefined) {
  if (!id) return null;
  const [u] = await db
    .select({ username: schema.user.username, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, id))
    .limit(1);
  return u ?? null;
}

// Positions of all holders across the given markets — powers comment badges
// (binary: one market id; group: the option child ids).
export async function getPositionBadges(marketIds: string[]) {
  if (!marketIds.length) return [];
  return db
    .select({
      userId: schema.position.userId,
      marketId: schema.position.marketId,
      yesShares: schema.position.yesShares,
      noShares: schema.position.noShares,
    })
    .from(schema.position)
    .where(inArray(schema.position.marketId, marketIds));
}
