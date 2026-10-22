// Leverage accounting — pure math shared by the trade actions.
import { multiCost, tradeCost } from "./lmsr";

// Principal of the loan a buy takes at `leverage`: collateral × (L-1).
export const loanFor = (spendCents: number, leverage: number) => spendCents * (leverage - 1);

// Liquidate when the position's liquidation value drops to 105% of its debt.
export const LIQ_CUSHION = 1.05;
// The 5% cushion fits leverage up to 20x — entry equity is debt/(L-1) ≥ 5% of
// the loan. Higher caps would be born under water, so the buffer shrinks
// proportionally: at 100x it's 0.05·19/99 ≈ 0.96% of the debt.
export function liqCushion(maxLeverage: number): number {
  return 1 + (LIQ_CUSHION - 1) * Math.min(1, 19 / Math.max(1, maxLeverage - 1));
}

// Cents the book pays if the position is sold fully right now: YES out first,
// then NO against the post-YES state (same order checkLiquidations applies).
// tradeCost returns a negative delta on the way out — negate to get the payout.
export function liquidationValueCents(
  qYes: number,
  qNo: number,
  b: number,
  yesShares: number,
  noShares: number
): number {
  return Math.round(
    -(tradeCost(qYes, qNo, b, "yes", -yesShares) +
      tradeCost(qYes - yesShares, qNo, b, "no", -noShares)) * 100
  );
}

export function shouldLiquidate(valueCents: number, debtCents: number, maxLeverage = 20): boolean {
  return valueCents <= debtCents * liqCushion(maxLeverage);
}

// Cents the group book pays to close `yesShares`/`noShares` on option `i`:
// YES removes its coordinate, NO removes the i-th bundle from every sibling.
export function groupLiquidationValueCents(
  coords: number[],
  b: number,
  i: number,
  yesShares: number,
  noShares: number
): number {
  const after = coords.map((q, j) => q - (j === i ? yesShares : noShares));
  return Math.round((multiCost(coords, b) - multiCost(after, b)) * 100);
}

// --- Game leverage (eToro-style margin) ---
// A leveraged bet posts the stake as margin and borrows the rest of the
// notional from the house: a win pays stake + (mult-1) × notional and the
// borrowing is released, a loss forfeits the whole notional — the borrowed
// leg stays on the books as house debt (it accrues, garnishes wins, blocks
// new leverage). The leveraged top-up is also bought with a one-off funding
// fee (like a broker's spread), charged up front.
export const LEV_FEE_BPS = 500; // default 5% of the borrowed notional — admin-tunable
// Funding fee steps up with leverage — bigger borrows pay a bigger rate:
// every full 5× of leverage multiplies the configured bps (2–5× → 1×bps,
// 6–10× → 2×bps, 11–15× → 3×bps …). No borrowed leg, no fee (1× is free).
export const LEV_TIER = 5;
export function levFeeBpsEff(leverage: number, bps = LEV_FEE_BPS): number {
  return bps * Math.ceil(Math.max(0, leverage) / LEV_TIER);
}
export function levFeeCents(betCents: number, leverage: number, bps = LEV_FEE_BPS): number {
  if (leverage <= 1) return 0;
  return Math.round(betCents * (leverage - 1) * (levFeeBpsEff(leverage, bps) / 10_000));
}
