import { randomInt } from "node:crypto";

// House debt — voluntary loans and leveraged game losses both land on the
// user row. A levered round borrows its notional at stake time (like CFD
// margin): a win releases the borrowing, a loss keeps it as debt that
// accrues interest, blocks new leverage, and garnishes future wins.
// The APR is rolled at borrow time (taking a loan is itself a gamble).
// Interest accrues lazily: every touch compounds the debt to `now` first.
export const DEBT_CAP_CENTS = 100_000_000; // Ɱ1M ceiling — keeps integer sane
export const LOAN_PRESETS_CENTS = [25_000, 100_000, 500_000]; // Ɱ250 / Ɱ1,000 / Ɱ5,000
export const LOAN_RATE_MIN_BPS = 50; // 0.5% APR
export const LOAN_RATE_MAX_BPS = 3000; // 30% APR
// The borrow minigame deals three hidden rate offers; the borrower picks a
// card and gets that rate — the gamble is which card hides the cheap money.
export const LOAN_OFFER_COUNT = 3;
export const LOAN_OFFER_TTL_MS = 10 * 60_000;
// Leveraged trade losses accrue at a fixed rate — no card gamble on margin
// calls; the debt is involuntary.
export const DEFAULT_DEBT_RATE_BPS = 2000; // 20% APR

// Wall constants live in lib/games.ts — client components can't import this
// file (node:crypto).
export function rollRateBps(): number {
  return LOAN_RATE_MIN_BPS + randomInt(LOAN_RATE_MAX_BPS - LOAN_RATE_MIN_BPS + 1);
}

export function accruedDebtCents(debt: number, rateBps: number, since: Date | null, now = new Date()): number {
  if (debt <= 0) return 0;
  if (!since || rateBps <= 0) return Math.min(DEBT_CAP_CENTS, Math.round(debt));
  const yrs = Math.max(0, (now.getTime() - new Date(since).getTime()) / (365 * 86400e3));
  return Math.min(DEBT_CAP_CENTS, Math.round(debt * Math.pow(1 + rateBps / 10000, yrs)));
}
