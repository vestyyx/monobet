// Pure money-management math (Phase 2.2) — DB-free validation for the admin
// money engine in lib/actions-admin.ts. Everything here is unit-tested; the
// server actions only wire DB + locking around these rules.
//
// Spelled-out principle from the roadmap: EVERY Mony change flows through the
// ledger, with a reason, inside a transaction, idempotently, and within
// per-role caps. Admins never edit balances directly.

// ---------- caps ----------
// Per-action caps keep a moderator mistake small. Semantically: how many
// Mony a single ledger row may move. The owner is uncapped.
export const MONEY_CAP_MODERATOR_CENTS = 100_000; // Ɱ1,000
export const MONEY_CAP_ADMIN_CENTS = 1_000_000; // Ɱ10,000

/** Per-action cap in cents for a role; null means uncapped (owner only). */
export function moneyCapCents(role: "user" | "moderator" | "admin" | "owner"): number | null {
  if (role === "owner") return null;
  if (role === "admin") return MONEY_CAP_ADMIN_CENTS;
  if (role === "moderator") return MONEY_CAP_MODERATOR_CENTS;
  return null; // users can't use the engine at all (checked server-side too)
}

/** Is a single-row delta of |amountCents| within this role's cap? */
export function moneyDeltaWithinCap(
  role: "user" | "moderator" | "admin" | "owner",
  amountCents: number
): boolean {
  if (role === "user") return false; // never granted the engine — belt & braces
  const cap = moneyCapCents(role);
  if (cap === null) return true; // owner is uncapped
  return Math.abs(Math.round(amountCents)) <= cap;
}

// ---------- parsing / normalization ----------
/** Parse an admin-entered amount of Monys into cents. Returns null when not a clean positive number ("105.5" is fine, "-3" is not here). */
export function parsePositiveMonos(raw: number | string): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const cents = Math.round(n * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}

/** Parse a "set balance to" target — zero is allowed (that starts fresh). */
export function parseTargetMonos(raw: number | string): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

/**
 * Delta for a "set-to-value" operation: what single difference entry brings
 * `balanceCents` to the requested target. Returns null when nothing changes.
 */
export function setDeltaCents(balanceCents: number, targetCents: number): number | null {
  const delta = targetCents - balanceCents;
  if (delta === 0 || !Number.isSafeInteger(delta)) return null;
  return delta;
}

/**
 * Delta for a reversal counter-entry: negative-ize the original row minus
 * whatever reversals already exist for it. Returns null when there is
 * nothing left to reverse (already fully or over- reversed).
 */
export function reverseDeltaCents(originalAmountCents: number, alreadyReversedCents: number): number | null {
  const delta = -originalAmountCents - alreadyReversedCents;
  if (delta === 0 || !Number.isSafeInteger(delta)) return null;
  return delta;
}

// ---------- ledger kinds ----------
export type MoneyOp = "grant" | "deduct" | "set" | "refund" | "transfer" | "reverse";

export type AdminMoneyKind = "grant" | "deduct" | "adjust" | "reverse" | "refund" | "transfer";

/** Ledger kinds the admin engine creates — used for the money page feed. */
export const ADMIN_LEDGER_KINDS = ["grant", "deduct", "adjust", "reverse", "refund", "transfer"] as const;

/** Ledger kind each operation writes. */
export function moneyKindFor(op: MoneyOp): AdminMoneyKind {
  switch (op) {
    case "grant":
      return "grant";
    case "deduct":
      return "deduct";
    case "set":
      return "adjust";
    case "refund":
      return "refund";
    case "transfer":
      return "transfer";
    case "reverse":
      return "reverse";
  }
}

/**
 * Which existing ledger rows the reversal engine may touch: only rows the
 * admin engine itself created (never game payouts or trades — those have
 * their own refund/settlement paths).
 */
export function kindIsReversible(kind: string): kind is AdminMoneyKind {
  return kind === "grant" || kind === "deduct" || kind === "adjust" || kind === "refund" || kind === "transfer";
}

// ---------- reasons / bulk ----------
/** Reasons are mandatory and must be human-meaningful (not whitespace noise). */
export function moneyReasonOk(reason: string): boolean {
  return (reason ?? "").trim().length >= 5 && (reason ?? "").trim().length <= 400;
}

/** Idempotency keys — short slugs the admin can pass or the UI can generate. */
export function moneyIdemKeyOk(key: string): boolean {
  return /^[a-z0-9][a-z0-9:_-]{0,99}$/i.test(key);
}

/** Bulk safety: one batch touches at most 500 players (family scale hardcoded). */
export const MONEY_BULK_MAX_TARGETS = 500;

/** Bulk preview: "affects N players, ⱮX in total". */
export function bulkSummary(count: number, centsPerPlayer: number): { count: number; totalCents: number; ok: boolean } {
  const total = Math.round(count * centsPerPlayer);
  return { count, totalCents: total, ok: count > 0 && count <= MONEY_BULK_MAX_TARGETS };
}
