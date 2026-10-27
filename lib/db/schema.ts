import { sql } from "drizzle-orm";
import type { MathProblem } from "@/lib/jobs";
import {
  pgTable,
  text,
  timestamp,
  date,
  boolean,
  integer,
  bigint,
  numeric,
  doublePrecision,
  uuid,
  index,
  jsonb,
  primaryKey,
  smallint,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------- Better Auth core tables ----------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // username plugin
  username: text("username").unique(),
  displayUsername: text("display_username"),
  // MonoBet additional fields
  role: text("role").notNull().default("user"),
  balanceCents: bigint("balance_cents", { mode: "number" }).notNull().default(100_000), // Ɱ1,000.00 start
  lastClaimAt: timestamp("last_claim_at", { withTimezone: true }),
  // Consecutive daily claims inside the 48h streak window.
  claimStreak: integer("claim_streak").notNull().default(0),
  // Consecutive correct Daily Trivia answers — feeds the streak multiplier
  // (lib/fun.ts). Resets to 0 on a wrong answer.
  triviaStreak: integer("trivia_streak").notNull().default(0),
  // Presence streak — UTC day the user was last seen, consecutive-day count,
  // and a throttled "last online" stamp for activity tracking.
  lastActiveDay: date("last_active_day", { mode: "string" }),
  activityStreak: integer("activity_streak").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  // Moderation: a full ban (sign-in rejected, sessions dropped) and a lighter
  // comments-only ban, both toggled from /admin.
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  banReason: text("ban_reason"),
  commentsBanned: boolean("comments_banned").notNull().default(false),
  // Temporary comment ban — a "timeout" that expires on its own.
  commentBanUntil: timestamp("comment_ban_until", { withTimezone: true }),
  // Admin-set restrictions (Phase 2+ money tools read these):
  // frozenAt blocks balance-earning/moving actions; kidMode enables stricter
  // limits; maxStakeCents caps this player's per-order stake (null = default).
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  kidMode: boolean("kid_mode").notNull().default(false),
  maxStakeCents: integer("max_stake_cents"),
  squadId: uuid("squad_id"),
  // Temp bans expire on their own (requireUser lifts them when the date
  // passes); permanent bans have bannedUntil = null.
  bannedUntil: timestamp("banned_until", { withTimezone: true }),
  // Group Parent (Phase 3): a rank inside the squad — parents may kick
  // members. null = ordinary member.
  squadRole: text("squad_role"),
  // House debt — voluntary loans land here (levered games never borrow). Rate is APR in
  // basis points rolled at borrow time; interest accrues lazily off debtSince.
  debtCents: bigint("debt_cents", { mode: "number" }).notNull().default(0),
  debtRateBps: integer("debt_rate_bps").notNull().default(0),
  debtSince: timestamp("debt_since", { withTimezone: true }),
  // Owed to the squad pot — interest-free, but you can't leave until repaid.
  squadDebtCents: bigint("squad_debt_cents", { mode: "number" }).notNull().default(0),
  // Auto-repay: when on, each loan repayment/trade first pays down the loan
  // and winnings feed the debt in full.
  autoRepay: boolean("auto_repay").notNull().default(false),
  // Notification prefs — resolve fan-out and closing-soon reminders.
  notifResolve: boolean("notif_resolve").notNull().default(true),
  notifClosing: boolean("notif_closing").notNull().default(true),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- MonoBet tables ----------

export type MarketStatus = "pending" | "live" | "resolved" | "cancelled" | "rejected";
export type MarketOutcome = "yes" | "no";
export type MarketKind = "binary" | "group" | "option";

// User-creatable market categories — starts empty; anyone can add one when
// creating a market, admins rename/delete in /admin.
export const category = pgTable("category", {
  name: text("name").primaryKey(),
  sortIndex: integer("sort_index").notNull().default(0),
  creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const market = pgTable(
  "market",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    // Previous slugs — old URLs keep working via permanent redirect.
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    question: text("question").notNull(),
    description: text("description").notNull().default(""),
    // Creator-provided background ("Market context" card) — optional.
    context: text("context").notNull().default(""),
    category: text("category").notNull().default("Other"),
    status: text("status").notNull().default("pending"),
    outcome: text("outcome"), // 'yes' | 'no' | null
    // Multi-outcome markets: a "group" parent holds the shared question;
    // each "option" child shares one multinomial book — coord_i = qYes_i +
    // Σ_siblings qNo_k and prices are the softmax over live options (sum = 1).
    kind: text("kind").notNull().default("binary"),
    parentId: uuid("parent_id").references((): AnyPgColumn => market.id, { onDelete: "cascade" }),
    label: text("label"), // option label on children, e.g. "September 30"
    sortIndex: integer("sort_index").notNull().default(0), // option order within a group
    imageUrl: text("image_url"), // optional picture — option logos, market icons
    b: doublePrecision("b").notNull().default(300), // LMSR liquidity parameter
    qYes: numeric("q_yes", { precision: 24, scale: 6 }).notNull().default("0"),
    qNo: numeric("q_no", { precision: 24, scale: 6 }).notNull().default("0"),
    volumeCents: bigint("volume_cents", { mode: "number" }).notNull().default(0),
    // The house seed baked into volumeCents at creation — recounts rebuild
    // volume as seed + surviving turnover, so the baseline survives formula
    // changes in houseSeedCents().
    seedCents: bigint("seed_cents", { mode: "number" }).notNull().default(0),
    traderCount: integer("trader_count").notNull().default(0),
    creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
    // Community resolution: an expired market can get a proposed outcome;
    // two confirm votes settle it, disputes escalate to admins.
    proposedOutcome: text("proposed_outcome"), // 'yes' | 'no' | null
    proposedById: text("proposed_by_id").references(() => user.id, { onDelete: "set null" }),
    proposedAt: timestamp("proposed_at", { withTimezone: true }),
    resolutionReason: text("resolution_reason").notNull().default(""),
    // Auto-clone: on resolve a fresh copy opens recurDays after this close.
    recurDays: integer("recur_days"),
    // Creator-chosen leverage ceiling — options inherit the parent's value.
    maxLeverage: integer("max_leverage").notNull().default(10),
    // Per-market spend ceiling (own cash per order) — null defers to the
    // global casino_config.trade_max_spend_cents.
    maxBetCents: integer("max_bet_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Scheduled open — trades are blocked until opens_at; recurring copies
    // shift it forward by one period alongside closes_at.
    opensAt: timestamp("opens_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("market_status_idx").on(t.status),
    index("market_category_idx").on(t.category),
    index("market_parent_idx").on(t.parentId),
  ]
);

export const trade = pgTable(
  "trade",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    side: text("side").notNull(), // 'buy' | 'sell'
    outcome: text("outcome").notNull(), // 'yes' | 'no'
    shares: numeric("shares", { precision: 24, scale: 6 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    yesPriceAfter: numeric("yes_price_after", { precision: 7, scale: 5 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("trade_market_idx").on(t.marketId, t.createdAt),
    index("trade_user_idx").on(t.userId, t.createdAt),
  ]
);

export const position = pgTable(
  "position",
  {
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    yesShares: numeric("yes_shares", { precision: 24, scale: 6 }).notNull().default("0"),
    noShares: numeric("no_shares", { precision: 24, scale: 6 }).notNull().default("0"),
    // Leverage: cents borrowed against this position. Repaid out of sells,
    // resolutions, and refunds; auto-liquidates when value can't cover it.
    debtCents: bigint("debt_cents", { mode: "number" }).notNull().default(0),
    // Auto-exit triggers per side — a share price (0..1). tp fills when the
    // price climbs to it, sl when it falls to it. Null = unset. Each trigger
    // fires once and clears; *_sell_pct caps the fill to a fraction of the
    // side (null = 100%).
    tpYes: numeric("tp_yes", { precision: 10, scale: 6 }),
    slYes: numeric("sl_yes", { precision: 10, scale: 6 }),
    tpNo: numeric("tp_no", { precision: 10, scale: 6 }),
    slNo: numeric("sl_no", { precision: 10, scale: 6 }),
    yesSellPct: integer("yes_sell_pct"),
    noSellPct: integer("no_sell_pct"),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.userId] }), index("position_user_idx").on(t.userId)]
);

export const pricePoint = pgTable(
  "price_point",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    yesPrice: numeric("yes_price", { precision: 7, scale: 5 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pp_market_idx").on(t.marketId, t.createdAt)]
);

export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    // One level of threading — replies attach to a top-level comment.
    parentId: uuid("parent_id").references((): AnyPgColumn => comment.id, { onDelete: "cascade" }),
    // Admin censor: body stays stored, UI renders a moderation placeholder.
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comment_market_idx").on(t.marketId, t.createdAt)]
);

export const commentVote = pgTable(
  "comment_vote",
  {
    commentId: uuid("comment_id").notNull().references(() => comment.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    value: smallint("value").notNull(), // 1 | -1
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })]
);

export const rewardClaim = pgTable(
  "reward_claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'weekly' | 'ad' | 'bonus:<key>'
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reward_user_idx").on(t.userId, t.createdAt),
    // One row per bonus kind per user — but bonus:referrer:<id> keys differ,
    // so referrals stay unlimited while plain bonuses claim once.
    uniqueIndex("reward_once_idx").on(t.userId, t.kind).where(sql`${t.kind} like 'bonus:%'`),
  ]
);

export type LedgerKind =
  | "signup"
  | "claim"
  | "weekly"
  | "ad"
  | "bonus"
  | "grant"
  | "deduct"
  | "adjust"
  | "reverse"
  | "buy"
  | "sell"
  | "payout"
  | "refund"
  | "game"
  | "job"
  | "liq"
  | "notify"
  | "duel"
  | "loan"
  | "repay"
  | "burn"
  | "debt"
  | "transfer"
  | "trivia"
  | "guess"
  | "poll"
  | "emoji"
  | "photo"
  | "quest";

export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(), // signed
    balanceAfterCents: bigint("balance_after_cents", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    marketId: uuid("market_id").references(() => market.id, { onDelete: "set null" }),
    memo: text("memo").notNull().default(""),
    // Admin-money bookkeeping (Phase 2.2): idempotency keys make repeated
    // submissions apply once; batch ids tie a bulk grant together for the
    // one-click undo. Both are sparse — player-driven rows stay null.
    idemKey: text("idem_key"),
    batchId: text("batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("ledger_idem_idx").on(t.idemKey).where(sql`"idem_key" is not null`),
    index("ledger_batch_idx").on(t.batchId).where(sql`"batch_id" is not null`),
  ]
);

// ---------- retention: weekly seasons ----------

// One live season at a time (settledAt IS NULL). Settlement is lazy: the first
// leaderboard view after endsAt closes it inside a guarded transaction.
export const season = pgTable(
  "season",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    index: integer("index").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("season_index_key").on(t.index)]
);

export const seasonResult = pgTable(
  "season_result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id").notNull().references(() => season.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    netWorthCents: bigint("net_worth_cents", { mode: "number" }).notNull(),
    rewardCents: integer("reward_cents").notNull(),
  },
  (t) => [index("season_result_season_idx").on(t.seasonId, t.rank)]
);

// ---------- community resolution ----------

// One vote per user per market. 'confirm' endorses the proposed outcome,
// 'dispute' blocks creator resolution and hands the decision to admins.
export const resolutionVote = pgTable(
  "resolution_vote",
  {
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    vote: text("vote").notNull(), // 'confirm' | 'dispute'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.userId] })]
);

// Community notes — user annotations arguing for an outcome on a resolvable
// market (binary or group option). The resolver reviews them before settling
// and can publish individual notes onto the market page above the rules.
// Markets with more than NOTE_ADMIN_GATE notes can only be resolved by an
// admin — the crowd flagged it, so the house signs off.
export const communityNote = pgTable(
  "community_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    stance: text("stance"), // 'yes' | 'no' | null — outcome the note argues for
    body: text("body").notNull(),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("community_note_market_idx").on(t.marketId, t.createdAt)]
);

export const jobShift = pgTable(
  "job_shift",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    job: text("job").notNull(),
    payload: jsonb("payload").$type<MathProblem[]>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    earnedCents: integer("earned_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_shift_user_idx").on(t.userId, t.createdAt)]
);

// ---------- squads ----------

// A named group users join freely — the leaderboard shows combined net worth
// per squad. One squad per user.
export const squad = pgTable(
  "squad",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    // Shared pot — members contribute, members borrow against it.
    treasuryCents: bigint("treasury_cents", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Phase 3 admin tools: a paused squad refuses new joins/invites/coins;
    // the parent shares a 6-char invite code with friends when enabled.
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    inviteCode: text("invite_code").unique(),
    inviteEnabled: boolean("invite_enabled").notNull().default(true),
  }
);

// Invites let squad members pull friends in by username instead of relying on
// them typing the exact squad name. One pending invite per (squad, invitee).
export const squadInvite = pgTable(
  "squad_invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squad.id, { onDelete: "cascade" }),
    inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    inviteeId: text("invitee_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("squad_invite_invitee_idx").on(t.inviteeId),
    unique("squad_invite_pair").on(t.squadId, t.inviteeId),
  ]
);

// ---------- duels (head-to-head) ----------

// A stakes a claim against B for equal Marks. Both stakes escrow at accept;
// the winner is proposed by one participant and confirmed by the other —
// disagreement goes 'disputed' and an admin settles (or refunds both).
export const challenge = pgTable(
  "challenge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: text("creator_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    opponentId: text("opponent_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    claim: text("claim").notNull(),
    stakeCents: integer("stake_cents").notNull(),
    // claim = the classic text bet; rps/roll are server-resolved party games —
    // picks and rolls live in state.
    kind: text("kind").notNull().default("claim"),
    state: jsonb("state"),
    status: text("status").notNull().default("open"), // open|accepted|declined|cancelled|settled|disputed
    winnerId: text("winner_id").references(() => user.id, { onDelete: "set null" }),
    pendingWinnerId: text("pending_winner_id").references(() => user.id, { onDelete: "set null" }),
    pendingById: text("pending_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [index("challenge_creator_idx").on(t.creatorId, t.createdAt), index("challenge_opponent_idx").on(t.opponentId, t.createdAt)]
);

// ---------- watchlist ----------

// Per-user starred markets — drives the "Watching" tab on the homepage.
export const watchlist = pgTable(
  "watchlist",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.marketId] })]
);

// ---------- market likes ----------

// Hearts on markets — a public signal (count on cards), separate from the
// private watchlist bookmark that drives the Watching tab.
export const marketLike = pgTable(
  "market_like",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    marketId: uuid("market_id").notNull().references(() => market.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.marketId] }), index("market_like_market_idx").on(t.marketId)]
);

// ---------- house config ----------

// Single-row config ("house") holding the admin-tunable economy knobs:
// trade leverage caps, fees, loan APR, referral royalties.
export const casinoConfig = pgTable("casino_config", {
  id: text("id").primaryKey(),
  // Leverage knobs — admin-settable. tradeMaxLev caps market orders,
  // levFeeBps is the funding fee on borrowed notional.
  tradeMaxLev: integer("trade_max_lev").notNull().default(10),
  levFeeBps: integer("lev_fee_bps").notNull().default(500),
  // tradeMaxSpendCents caps a market order's own-cash spend; a market's
  // max_bet_cents column can tighten that per market.
  tradeMaxSpendCents: integer("trade_max_spend_cents").notNull().default(500000),
  // House rules — admin-tunable. tradeFeeCents is the flat order fee;
  // debtRateBps is the loan APR.
  tradeFeeCents: integer("trade_fee_cents").notNull().default(100),
  debtRateBps: integer("debt_rate_bps").notNull().default(2000),
  referralRoyaltyBps: integer("referral_royalty_bps").notNull().default(500),
  referralRoyaltyCapCents: integer("referral_royalty_cap_cents").notNull().default(200_000),
  minTradeCents: integer("min_trade_cents").notNull().default(1000),
  // Economy resets move this forward: bank stats and balance-history charts
  // only count ledger rows after the epoch — whale-era churn stays in the
  // ledger for audit but out of the displayed numbers.
  statsSince: timestamp("stats_since", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- admin ----------

// Immutable audit log — one row per admin action (money moves, moderation,
// config changes, user edits). Rows are never updated or deleted by the app;
// the UI only reads them. `before`/`after` JSON snapshots keep the action
// reviewable; `reason` is the admin-acknowledged justification text.
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: text("admin_id").notNull(), // acting admin (no FK: survives user deletion)
    adminName: text("admin_name").notNull().default(""), // username snapshot at action time
    action: text("action").notNull(), // e.g. "money.grant", "user.ban", "market.resolve"
    targetType: text("target_type").notNull().default(""), // "user" | "market" | "ledger" | "config" | …
    targetId: text("target_id").notNull().default(""),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason").notNull().default(""), // required for money + destructive actions
    ip: text("ip").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_audit_created_idx").on(t.createdAt),
    index("admin_audit_admin_idx").on(t.adminId, t.createdAt),
    index("admin_audit_action_idx").on(t.action, t.createdAt),
    index("admin_audit_target_idx").on(t.targetType, t.targetId),
  ]
);

// Moderation reports — reported content (comments, markets, photos, users)
// waits in the queue until a moderator resolves or dismisses it.
export const report = pgTable(
  "report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // comment | market | photo | user | duel
    targetId: text("target_id").notNull(),
    reporterId: text("reporter_id").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason").notNull().default(""),
    status: text("status").notNull().default("open"), // open | resolved | dismissed
    assigneeId: text("assignee_id"), // moderator who took the case (no FK: resilient)
    resolutionNote: text("resolution_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("report_status_idx").on(t.status, t.createdAt)]
);

// Economy/platform config snapshots — every settings save stores the full
// knob set as a version with author, note and timestamp; UI can diff and roll
// back. The live config still lives in casino_config (single source).
export const configVersion = pgTable("config_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  data: jsonb("data").notNull(), // full knob map at save time
  changedBy: text("changed_by").notNull(),
  changedByName: text("changed_by_name").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Player restriction columns live on the user table above (Phase 1 groundwork
// for money freeze + kid mode): frozenAt freezes balance ops; kidMode shrinks
// limits; maxStakeCents overrides the platform stake cap for that player.

// ---------- family games (the friendly corner) ----------
// All games here are free-play party games: no stakes leave the player, only
// small fixed Mony rewards flow out through the ledger. Content is bilingual
// (CZ/EN columns) and rewards never read like winnings of a bet.

// Daily trivia — one question per day for the whole platform. Questions come
// from an admin-fed bank; the first visitor of the day "pins" one bank row by
// claiming it for `shownDay` (conditional UPDATE = race-safe, see actions-fun).
// A non-null shownDay is unique by construction below, so a day can never get
// two questions even with concurrent pinners.
export const triviaQuestion = pgTable(
  "trivia_question",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qCs: text("q_cs").notNull(),
    qEn: text("q_en").notNull(),
    optionsCs: jsonb("options_cs").$type<string[]>().notNull(),
    optionsEn: jsonb("options_en").$type<string[]>().notNull(),
    correctIdx: integer("correct_idx").notNull(), // 0-3
    difficulty: integer("difficulty").notNull().default(1), // 1 easy Ɱ100 · 2 Ɱ150 · 3 Ɱ200
    rewardCents: integer("reward_cents"), // override when set, else derived from difficulty
    shownDay: date("shown_day", { mode: "string" }), // UTC day this question is/was live
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trivia_bank_day_idx").on(t.shownDay)]
);

// One answer per player per question — the unique index makes double answers
// impossible even if two requests race.
export const triviaAnswer = pgTable(
  "trivia_answer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => triviaQuestion.id, { onDelete: "cascade" }),
    chosen: integer("chosen").notNull(),
    correct: boolean("correct").notNull(),
    rewardCents: integer("reward_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trivia_answer_once_idx").on(t.userId, t.questionId),
    index("trivia_answer_user_idx").on(t.userId, t.createdAt),
  ]
);

// Closest guess — a friendly "how many pancakes will Dad eat?" estimation
// round. Everyone may re-tune their number until closeAt; then an admin/back
// reveals the real value and the closest entry wins the fixed reward, with a
// small consolation for everyone inside the consolation window. Free to play.
export const guessRound = pgTable(
  "guess_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptCs: text("prompt_cs").notNull(),
    promptEn: text("prompt_en").notNull(),
    unitCs: text("unit_cs").notNull().default(""), // e.g. "papanců" — shown after numbers
    unitEn: text("unit_en").notNull().default(""),
    closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
    answerValue: bigint("answer_value", { mode: "number" }), // revealed at settle
    status: text("status").notNull().default("open"), // open | settled
    rewardCents: integer("reward_cents").notNull().default(20_000), // Ɱ200 for the closest
    consolationCents: integer("consolation_cents").notNull().default(5_000), // within window
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    settledBy: text("settled_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("guess_round_status_idx").on(t.status, t.closeAt)]
);

export const guessEntry = pgTable(
  "guess_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").notNull().references(() => guessRound.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    value: bigint("value", { mode: "number" }).notNull(),
    // Payout stamps filled at settle — 0 means no reward for this entry.
    rewardCents: integer("reward_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("guess_entry_once_idx").on(t.roundId, t.userId),
    index("guess_entry_round_idx").on(t.roundId),
  ]
);

// Group poll — one two-option question ("Sunday pancakes: mami vs táta style?").
// The friendly joke: the MINORITY side wins in full, the majority gets a kind
// token (configurable, often Ɱ0). One open round at a time is an admin habit,
// not an invariant; closing is by closeAt, settling pays per vote.
export const pollRound = pgTable(
  "poll_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    qCs: text("q_cs").notNull(),
    qEn: text("q_en").notNull(),
    aCs: text("a_cs").notNull(),
    aEn: text("a_en").notNull(),
    bCs: text("b_cs").notNull(),
    bEn: text("b_en").notNull(),
    closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("open"), // open | settled
    rewardCents: integer("reward_cents").notNull().default(10_000), // per minority voter
    consolationCents: integer("consolation_cents").notNull().default(0), // majority token, often off
    winningSide: text("winning_side"), // 'a' | 'b' | 'both' (tie) — stamped at settle
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    settledBy: text("settled_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("poll_round_status_idx").on(t.status, t.closeAt)]
);

export const pollVote = pgTable(
  "poll_vote",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pollId: uuid("poll_id").notNull().references(() => pollRound.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    side: text("side").notNull(), // 'a' | 'b' — switchable while the poll is open
    rewardCents: integer("reward_cents").notNull().default(0), // payout stamp from settle
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("poll_vote_once_idx").on(t.pollId, t.userId),
    index("poll_vote_poll_idx").on(t.pollId),
  ]
);

// Word/emoji riddle — an admin posts "🍕🌧️" and the family races to type the
// matching phrase. Every player gets EMOJI_MAX_ATTEMPTS guesses; the FIRST
// correct guess takes the whole prize and settles the round on the spot.
// The partial unique index below (one correct row per round) makes the
// "first" in "first solver" race-safe.
export const emojiRound = pgTable(
  "emoji_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emoji: text("emoji").notNull(), // the riddle face, e.g. "🍕🌧️"
    answerCs: text("answer_cs").notNull(),
    answerEn: text("answer_en").notNull(),
    hintCs: text("hint_cs").notNull().default(""),
    hintEn: text("hint_en").notNull().default(""),
    hintAt: timestamp("hint_at", { withTimezone: true }).notNull(), // when the nudge unlocks
    closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("open"), // open | settled
    rewardCents: integer("reward_cents").notNull().default(15_000), // first solver
    winnerUserId: text("winner_user_id"),
    revealedBy: text("revealed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("emoji_round_status_idx").on(t.status, t.closeAt)]
);

export const emojiAttempt = pgTable(
  "emoji_attempt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").notNull().references(() => emojiRound.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    guess: text("guess").notNull(),
    correct: boolean("correct").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "First solver wins" as a database guarantee: at most one correct attempt
    // row per round can exist under any concurrency.
    uniqueIndex("emoji_first_solver_idx").on(t.roundId).where(sql`correct`),
    index("emoji_attempt_round_idx").on(t.roundId, t.userId),
  ]
);

// Family quests — real-life tasks ("take the recycling down", "read 20
// pages"). Players claim a quest, optionally attach proof (a note, or a photo
// for bigger deeds), and a parent/admin reviews the claim: approval pays the
// fixed reward through the ledger, rejection costs nothing. One claim per
// quest per player; a rejected claim can be re-submitted (reset to pending).
export const quest = pgTable(
  "quest",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    titleCs: text("title_cs").notNull(),
    titleEn: text("title_en").notNull(),
    descCs: text("desc_cs").notNull().default(""),
    descEn: text("desc_en").notNull().default(""),
    rewardCents: integer("reward_cents").notNull().default(10_000), // per approved claim
    proofKind: text("proof_kind").notNull().default("none"), // none | text | photo
    proofAskCs: text("proof_ask_cs").notNull().default(""), // what to write / show
    proofAskEn: text("proof_ask_en").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quest_active_idx").on(t.active, t.createdAt)]
);

export const questClaim = pgTable(
  "quest_claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questId: uuid("quest_id").notNull().references(() => quest.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    note: text("note").notNull().default(""), // text proof or a note to the parent
    photoData: text("photo_data"), // data URL when the quest asks for photo proof
    rewardCents: integer("reward_cents").notNull().default(0), // payout stamp
    reviewedBy: text("reviewed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("quest_claim_once_idx").on(t.questId, t.userId),
    index("quest_claim_status_idx").on(t.status, t.createdAt),
  ]
);

// Photo guess — the admin publishes a photo ("what is this a macro shot of?")
// and the family races to name it. Same race mechanics as emoji riddles:
// three guesses per player, first correct solver settles the round and takes
// the prize (partial unique index = race-safe), nudge unlocks mid-round.
// Photos are stored as compressed data URLs directly in the DB — small,
// family-scale amounts only, no external storage needed.
export const photoRound = pgTable(
  "photo_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageData: text("image_data").notNull(), // data URL (image/jpeg|png|webp, compressed)
    qCs: text("q_cs").notNull(), // e.g. "Co je na fotce?"
    qEn: text("q_en").notNull(),
    answerCs: text("answer_cs").notNull(),
    answerEn: text("answer_en").notNull(),
    hintCs: text("hint_cs").notNull().default(""),
    hintEn: text("hint_en").notNull().default(""),
    hintAt: timestamp("hint_at", { withTimezone: true }).notNull(),
    closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("open"), // open | settled
    rewardCents: integer("reward_cents").notNull().default(20_000), // first solver
    winnerUserId: text("winner_user_id"),
    revealedBy: text("revealed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("photo_round_status_idx").on(t.status, t.closeAt)]
);

export const photoAttempt = pgTable(
  "photo_attempt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").notNull().references(() => photoRound.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    guess: text("guess").notNull(),
    correct: boolean("correct").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Same first-solver guarantee as the emoji riddles — one correct row max.
    uniqueIndex("photo_first_solver_idx").on(t.roundId).where(sql`correct`),
    index("photo_attempt_round_idx").on(t.roundId, t.userId),
  ]
);
