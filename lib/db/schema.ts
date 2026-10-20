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
  squadId: uuid("squad_id"),
  // House debt — voluntary loans land here (levered games never borrow). Rate is APR in
  // basis points rolled at borrow time; interest accrues lazily off debtSince.
  debtCents: bigint("debt_cents", { mode: "number" }).notNull().default(0),
  debtRateBps: integer("debt_rate_bps").notNull().default(0),
  debtSince: timestamp("debt_since", { withTimezone: true }),
  // Owed to the squad pot — interest-free, but you can't leave until repaid.
  squadDebtCents: bigint("squad_debt_cents", { mode: "number" }).notNull().default(0),
  // The Wall — last prayer timestamp for the cooldown, and the vow: a pledged
  // share of every win (bps) garnished to debt until it's clear.
  wallPrayerAt: timestamp("wall_prayer_at", { withTimezone: true }),
  vowBps: integer("vow_bps").notNull().default(0),
  // Auto-repay: when on, winnings feed the debt in full (vow = 100%) and each
  // stake/trade first pays down the loan from spare balance.
  autoRepay: boolean("auto_repay").notNull().default(false),
  // Admin-tuned luck: bps chance to rescue a loss into a win (− = unlucky).
  // Random games only — skill games (timer, blackjack) ignore it.
  luckBps: integer("luck_bps").notNull().default(0),
  // Minigame daily cap: game_session_start anchors the rolling 24h window
  // (first stake of the day); game_played_ms banks in-game time and
  // game_last_play_at marks the last stake so ≥30min gaps don't accrue.
  gameSessionStart: timestamp("game_session_start", { withTimezone: true }),
  gameLastPlayAt: timestamp("game_last_play_at", { withTimezone: true }),
  gamePlayedMs: bigint("game_played_ms", { mode: "number" }).notNull().default(0),
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
  | "transfer";

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_user_idx").on(t.userId, t.createdAt)]
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

// ---------- blackjack ----------

// Notes left at the Wall of Debts — public ledger of who begged for relief.
export const wallPrayer = pgTable("wall_prayer", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  note: text("note").notNull().default(""),
  feeCents: bigint("fee_cents", { mode: "number" }).notNull(),
  clearedCents: bigint("cleared_cents", { mode: "number" }).notNull(),
  miracle: boolean("miracle").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Dealer personas — admin-configured characters that front the automated
// blackjack dealer. Each round snapshots the persona so edits can't
// rewrite history.
export const dealerPersona = pgTable("dealer_persona", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  avatar: text("avatar").notNull().default(""),
  quipWin: text("quip_win").notNull().default(""), // shown when the dealer wins
  quipLose: text("quip_lose").notNull().default(""), // dealer loses or pushes
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A live blackjack hand — deck and cards live server-side so hit/stand can't
// forge draws. Settles inside the deal/hit/stand actions via settleGame.
export const blackjackRound = pgTable(
  "blackjack_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    betCents: integer("bet_cents").notNull(),
    leverage: integer("leverage").notNull().default(1),
    deck: jsonb("deck").notNull().$type<number[]>(), // remaining shoe, ints 0-51
    player: jsonb("player").notNull().$type<number[]>(),
    dealer: jsonb("dealer").notNull().$type<number[]>(),
    persona: jsonb("persona").notNull().$type<{ name: string; avatar: string; quipWin: string; quipLose: string }>(),
    status: text("status").notNull().default("playing"), // playing | settled
    result: text("result"), // win | lose | push | blackjack | surrender
    netCents: integer("net_cents"),
    loanCents: bigint("loan_cents", { mode: "number" }).notNull().default(0), // leverage funding fee paid at deal (legacy name)
    // Side bets settled at deal time — stake, payout, and the hand label hit.
    sides: jsonb("sides").$type<Record<string, { stake: number; winCents: number; label: string | null }>>(),
    doubled: boolean("doubled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [index("blackjack_round_user_idx").on(t.userId, t.createdAt)]
);

// One row per stop-the-timer round. The stake is debited when the row is
// created — an abandoned round forfeits the wager, and the atomic settled_at
// claim makes the round single-use (no token replay, no forged elapsed).
export const timerRound = pgTable(
  "timer_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    targetMs: integer("target_ms").notNull(),
    // Hidden ±ms offset added at start; the round grades elapsed against
    // target+jitter so a pre-timed stop request can't snipe the top tier.
    jitterMs: integer("jitter_ms").notNull().default(0),
    betCents: integer("bet_cents").notNull(),
    leverage: integer("leverage").notNull().default(1),
    feeCents: integer("fee_cents").notNull().default(0), // leverage funding fee, burned at start
    settledAt: timestamp("settled_at", { withTimezone: true }),
    // App-clock anchor captured at action entry — grading uses this, not
    // created_at (Postgres now()), so DB clock skew and insert latency can't
    // leak into the measured elapsed.
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("timer_round_user_idx").on(t.userId, t.createdAt)]
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

// Hi-Lo — the server deals the face card at start (stake charged), the
// player's direction commits at play and the next card settles the round.
export const hiloRound = pgTable(
  "hilo_round",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    faceCard: integer("face_card").notNull(),
    betCents: integer("bet_cents").notNull(),
    leverage: integer("leverage").notNull().default(1),
    feeCents: integer("fee_cents").notNull().default(0),
    dir: text("dir"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("hilo_round_user_idx").on(t.userId, t.createdAt)]
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
    // claim = the classic text bet; rps/roll/wheel/slots are server-resolved
    // minigames — moves and rolls live in state.
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

// ---------- casino tuning ----------

// Single-row house config ("house"): rig_bps quietly flips that share of
// player wins into losses across the random games. Admin-editable.
export const casinoConfig = pgTable("casino_config", {
  id: text("id").primaryKey(),
  rigBps: integer("rig_bps").notNull().default(0),
  // Admin kill-switch — canonical game keys that refuse new stakes.
  disabledGames: text("disabled_games").array().notNull().default(sql`'{}'::text[]`),
  // Leverage knobs — admin-settable. gameMaxLev caps every minigame,
  // tradeMaxLev caps market orders, levFeeBps is the funding fee on borrowed
  // notional (both games and leveraged trades), gameLevCaps overrides per
  // game key ({"dice":5}).
  gameMaxLev: integer("game_max_lev").notNull().default(10),
  tradeMaxLev: integer("trade_max_lev").notNull().default(10),
  levFeeBps: integer("lev_fee_bps").notNull().default(500),
  gameLevCaps: jsonb("game_lev_caps").$type<Record<string, number>>(),
  // Stake ceilings — admin-settable. gameMaxBetCents is the default per-round
  // base-stake cap, gameBetCaps overrides per game key, tradeMaxSpendCents
  // caps a market order's own-cash spend; a market's max_bet_cents column can
  // tighten that per market.
  gameMaxBetCents: integer("game_max_bet_cents").notNull().default(100000),
  tradeMaxSpendCents: integer("trade_max_spend_cents").notNull().default(500000),
  gameBetCaps: jsonb("game_bet_caps").$type<Record<string, number>>(),
  // House rules — formerly hardcoded, now admin-tunable. autobetEnabled gates
  // the autobet UI; the session clock caps in-game ms per 24h window, with
  // idleMs the gap that pauses it. Fee columns are the flat round/order fees;
  // debtRateBps is the loan APR; dice/limbo pay columns scale the fair odds.
  autobetEnabled: boolean("autobet_enabled").notNull().default(true),
  gameDailyLimitMs: integer("game_daily_limit_ms").notNull().default(7_200_000),
  gameIdleMs: integer("game_idle_ms").notNull().default(1_800_000),
  gameFeeCents: integer("game_fee_cents").notNull().default(100),
  tradeFeeCents: integer("trade_fee_cents").notNull().default(100),
  debtRateBps: integer("debt_rate_bps").notNull().default(2000),
  referralRoyaltyBps: integer("referral_royalty_bps").notNull().default(500),
  referralRoyaltyCapCents: integer("referral_royalty_cap_cents").notNull().default(200_000),
  dicePayBps: integer("dice_pay_bps").notNull().default(9200),
  limboPayBps: integer("limbo_pay_bps").notNull().default(9600),
  limboMinX100: integer("limbo_min_x100").notNull().default(110),
  minTradeCents: integer("min_trade_cents").notNull().default(1000),
  // Economy resets move this forward: bank stats and balance-history charts
  // only count ledger rows after the epoch — whale-era churn stays in the
  // ledger for audit but out of the displayed numbers.
  statsSince: timestamp("stats_since", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Daily jackpot — a share of every game's handle pools into a pot drawn once
// a day; each wagered ticket is a weighted entry. The draw itself happens
// lazily in getJackpot() when the first request lands after draw_at.
export const jackpotRound = pgTable("jackpot_round", {
  id: uuid("id").primaryKey().defaultRandom(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  drawAt: timestamp("draw_at", { withTimezone: true }).notNull(),
  drawnAt: timestamp("drawn_at", { withTimezone: true }),
  winnerId: text("winner_id").references(() => user.id, { onDelete: "set null" }),
  poolCents: bigint("pool_cents", { mode: "number" }).notNull().default(0),
  tickets: integer("tickets").notNull().default(0),
});
