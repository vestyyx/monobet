// LMSR (logarithmic market scoring rule) binary market maker.
// qYes/qNo = net shares issued per outcome. Prices are probabilities in (0,1).
// Buying pushes the price toward 1; selling back reduces outstanding shares.

// One trade can't move more than this in notional (spend × leverage), so
// nobody can take a six-figure hit in one click.
export const MAX_TRADE_CENTS = 100_000_00;

// Per-order caps: the cash a trader commits is capped at Ɱ5 000; leverage
// multiplies into the notional cap above. Minimum order is Ɱ10.
export const MIN_TRADE_CENTS = 1_000;
export const MAX_TRADE_SPEND_CENTS = 500_000;

// Display seed: a fresh market shows this much "volume" so it doesn't look
// dead — scaled to the chosen liquidity tier (thin Ɱ100, standard Ɱ5 000,
// deep Ɱ25 000). Stat recounts add surviving turnover on top of it.
export function houseSeedCents(b: number): number {
  if (b >= 3000) return 2_500_000;
  if (b >= 1000) return 500_000;
  return 10_000;
}

// Flat fee per order — placing (buy) and closing (sell) both pay it. A money
// sink: the fee is burned, not credited anywhere.
export const TRADE_FEE_CENTS = 100;

export function lmsrCost(qYes: number, qNo: number, b: number): number {
  const m = Math.max(qYes, qNo);
  return m + b * Math.log(Math.exp((qYes - m) / b) + Math.exp((qNo - m) / b));
}

export function yesPrice(qYes: number, qNo: number, b: number): number {
  return 1 / (1 + Math.exp((qNo - qYes) / b));
}

// Yes-side quantity that makes the LMSR open at probability `p` (qNo = 0).
export function qForProb(p: number, b: number): number {
  return b * Math.log(p / (1 - p));
}

// Cost in marks to buy `shares` of `outcome` (or refund when shares < 0).
export function tradeCost(
  qYes: number,
  qNo: number,
  b: number,
  outcome: "yes" | "no",
  shares: number
): number {
  const before = lmsrCost(qYes, qNo, b);
  const after =
    outcome === "yes" ? lmsrCost(qYes + shares, qNo, b) : lmsrCost(qYes, qNo + shares, b);
  return after - before;
}

// Shares obtainable for `spend` marks of `outcome` via binary search (cost is monotonic).
export function sharesForSpend(
  qYes: number,
  qNo: number,
  b: number,
  outcome: "yes" | "no",
  spend: number
): number {
  let lo = 0;
  let hi = spend * 2 + b * 4;
  while (tradeCost(qYes, qNo, b, outcome, hi) < spend) hi *= 2;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (tradeCost(qYes, qNo, b, outcome, mid) <= spend) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---- Multi-outcome (group) book ----
// Sibling options share one LMSR surface. A YES share on option i pays only
// when i wins; a NO share on option i is the complement bundle — one share of
// every other outcome — so option i's outstanding NO count qNo_i lifts every
// sibling's coordinate. Live option j's coordinate:
//   coord_j = qYes_j + Σ_{k≠j} qNo_k
// Prices are the softmax over live coordinates, so they always sum to 1.
// Resolved/cancelled options drop out of the live set; their coordinates stop
// counting, which renormalizes the survivors automatically.

export type GroupOptionState = { qYes: number; qNo: number };

export function multiCoords(opts: GroupOptionState[]): number[] {
  const noTotal = opts.reduce((s, o) => s + o.qNo, 0);
  return opts.map((o) => o.qYes + noTotal - o.qNo);
}

export function multiCost(coords: number[], b: number): number {
  const m = Math.max(...coords);
  return m + b * Math.log(coords.reduce((s, q) => s + Math.exp((q - m) / b), 0));
}

export function multiPrices(coords: number[], b: number): number[] {
  const m = Math.max(...coords);
  const ex = coords.map((q) => Math.exp((q - m) / b));
  const sum = ex.reduce((a, e) => a + e, 0);
  return ex.map((e) => e / sum);
}

// Coordinate delta of a trade on option `i`: YES moves only its own
// coordinate; NO (the complement bundle) moves every sibling's.
function multiAfter(coords: number[], i: number, outcome: "yes" | "no", shares: number): number[] {
  return coords.map((q, j) =>
    outcome === "yes" ? q + (j === i ? shares : 0) : q + (j === i ? 0 : shares)
  );
}

// Cost in marks of `shares` of `outcome` on option `i` (negative on the way
// out → a refund).
export function multiTradeCost(
  coords: number[],
  b: number,
  i: number,
  outcome: "yes" | "no",
  shares: number
): number {
  return multiCost(multiAfter(coords, i, outcome, shares), b) - multiCost(coords, b);
}

// Shares obtainable for `spend` marks on option `i` — same monotonic search
// as the binary book.
export function multiSharesForSpend(
  coords: number[],
  b: number,
  i: number,
  outcome: "yes" | "no",
  spend: number
): number {
  let lo = 0;
  let hi = spend * 2 + b * 4;
  while (multiTradeCost(coords, b, i, outcome, hi) < spend) hi *= 2;
  for (let it = 0; it < 64; it++) {
    const mid = (lo + hi) / 2;
    if (multiTradeCost(coords, b, i, outcome, mid) <= spend) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Coordinate seed so a fresh book opens at probability `p` for that option
// (softmax of b·ln p over options ⇒ normalized opening prices).
export function multiQForProb(p: number, b: number): number {
  return b * Math.log(Math.min(0.999, Math.max(0.0001, p)));
}
