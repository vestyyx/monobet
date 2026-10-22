// Reward catalog — all amounts in cents (Ɱ100 = 10_000).
export const DAILY_AMOUNT = 25_000;
export const DAILY_COOLDOWN_MS = 20 * 3600 * 1000;
export const WEEKLY_AMOUNT = 100_000; // Ɱ1,000
export const WEEKLY_COOLDOWN_MS = 7 * 24 * 3600 * 1000;
export const AD_AMOUNT = 5_000; // Ɱ50
export const AD_COOLDOWN_MS = 30 * 60 * 1000;
export const AD_WATCH_MS = 12_000;

// One-time bonuses. `check` milestones are verified server-side; link bonuses
// open their href in the same click that claims — the visit IS the claim.
export const BONUSES = [
  { key: "portfolio", amountCents: 10_000, href: "https://www.tdvorak.dev/", check: null },
  { key: "instagram", amountCents: 10_000, href: "https://www.instagram.com/tdvorak.dev/", check: null },
  { key: "github", amountCents: 7_500, href: "https://github.com/Dvorinka/monobet", check: null },
  { key: "first_bet", amountCents: 10_000, href: null, check: "bet" },
  { key: "first_market", amountCents: 15_000, href: "/propose", check: "market" },
  { key: "first_comment", amountCents: 5_000, href: "/", check: "comment" },
  { key: "avatar", amountCents: 5_000, href: null, check: "avatar" },
  { key: "watchlist", amountCents: 2_500, href: "/markets", check: "watchlist" },
  { key: "heart", amountCents: 2_500, href: "/markets", check: "like" },
  { key: "duel", amountCents: 7_500, href: "/duels", check: "duel" },
  { key: "squad", amountCents: 5_000, href: null, check: "squad" },
  { key: "ten_trades", amountCents: 20_000, href: "/markets", check: "tenTrades" },
  { key: "streak7", amountCents: 25_000, href: null, check: "streak7" },
  { key: "first_sell", amountCents: 5_000, href: "/markets", check: "sell" },
  { key: "note", amountCents: 5_000, href: "/markets", check: "note" },
  { key: "vote", amountCents: 2_500, href: "/markets", check: "vote" },
  { key: "duel_win", amountCents: 10_000, href: "/duels", check: "duelWin" },
  { key: "squad_owner", amountCents: 7_500, href: null, check: "squadOwner" },
  { key: "referrer", amountCents: 10_000, href: null, check: "referrer" },
  { key: "fifty_trades", amountCents: 30_000, href: "/markets", check: "fiftyTrades" },
  { key: "active7", amountCents: 10_000, href: "/rewards", check: "active7" },
] as const;

export type BonusKey = (typeof BONUSES)[number]["key"];
export const BONUS_MAP = new Map(BONUSES.map((b) => [b.key, b]));

// Referral: the invitee gets this once, the referrer gets REFERRER_BONUS per join
// plus a royalty on everything the invitee goes on to earn.
export const REFEREE_BONUS = 10_000;
export const REFERRER_BONUS = 20_000;
// 5% of the invitee's lifetime earned income (faucet + winnings), claimable
// repeatedly and capped per invitee so a whale can't mint infinite referrer
// money. `grant`/`sell`/`loan`/`transfer`/`refund` are excluded — admin gifts
// and principal moves aren't earnings.
export const REFERRAL_ROYALTY_BPS = 500;
export const REFERRAL_ROYALTY_CAP_CENTS = 200_000; // Ɱ2,000 per invitee — lifetime cap
export const REFERRAL_EARN_KINDS = ["signup", "claim", "weekly", "ad", "activity", "bonus", "job", "payout", "duel"] as const;

// Claim streaks: gap must stay under 48h (20h cooldown + slack) to keep the
// streak alive; each streak day adds Marks up to a 7-day cap.
export const STREAK_WINDOW_MS = 48 * 3600 * 1000;
export const STREAK_PER_DAY_CENTS = 1_000;
export const STREAK_CAP_DAYS = 7;
// Presence streak — a small bonus credited on the first hit of each UTC day.
// Deliberately smaller than the daily claim: it rewards showing up, not work.
export const ACTIVITY_BASE_CENTS = 500;
export const ACTIVITY_PER_DAY_CENTS = 500;
export const ACTIVITY_CAP_CENTS = 5_000;
// last_seen_at is stamped at most this often — presence tracking must not turn
// every request into a write.
export const SEEN_THROTTLE_MS = 15 * 60 * 1000;

// Weekly seasons: lazy settlement, podium rewards.
export const SEASON_LENGTH_MS = 7 * 24 * 3600 * 1000;
export const SEASON_REWARDS = [200_000, 100_000, 50_000] as const;
