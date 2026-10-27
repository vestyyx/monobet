// Pure user/group management math (Phase 3) — DB-free validation for the
// players, groups and approvals admin tools in lib/actions-admin.ts.
// Same principle as lib/admin-money.ts: rules live here, unit-tested; server
// actions only wire DB + locking around them.
//
// Kept DB-free on purpose — the role ladder is mirrored from
// lib/admin/rbac.ts (low → high: user, moderator, admin, owner).

type Role = "user" | "moderator" | "admin" | "owner";
const RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2, owner: 3 };
const rankOf = (r: Role): number => RANK[r];

// ---------- role changes ----------
/**
 * May `actor` change the stored role of a user currently holding
 * `targetCurrent` to `targetNew`?
 *
 * Ladder rules (low → high: user, moderator, admin, owner):
 *  - owner accounts are untouchable (the platform owner can never be
 *    demoted/renamed by anyone — not even by accident of the UI),
 *  - you may only manage players BELOW your own rank,
 *  - you may never create a peer: the new role must also be below your rank.
 * Net effect: admins set user ↔ moderator, the owner handles admins.
 */
export type RoleChangeVerdict = "ok" | "owner-untouchable" | "target-too-high" | "would-create-peer";

export function roleChangeAllowed(
  actor: Role,
  targetCurrent: Role,
  targetNew: Role
): RoleChangeVerdict {
  if (targetCurrent === "owner") return "owner-untouchable";
  if (rankOf(actor) < RANK.moderator) return "target-too-high"; // users never manage roles
  if (rankOf(actor) <= rankOf(targetCurrent)) return "target-too-high";
  if (rankOf(targetNew) >= rankOf(actor)) return "would-create-peer";
  return "ok";
}

// ---------- bans ----------
/** Ban reasons reuse the money rule: human-meaningful, 5..400 chars. */
export function banReasonOk(reason: string): boolean {
  return (reason ?? "").trim().length >= 5 && (reason ?? "").trim().length <= 400;
}

/** Temp-ban duration: whole days, 1..365 (0 would be a no-op, longer is overkill). */
export function banDaysOk(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= 365;
}

// ---------- per-player stake caps ----------
/** Kid mode hard-caps a single order at Ɱ50 — family scale, not a casino. */
export const KID_MAX_STAKE_CENTS = 5_000;

/**
 * The effective per-order stake cap for one player:
 *   market/global ceiling ∩ personal max-stake ∩ kid-mode floor.
 * The smallest wins; the player can always trade at least the market minimum.
 */
export function personalStakeCapCents(
  kidMode: boolean,
  maxStakeCents: number | null | undefined,
  marketOrGlobalCapCents: number
): number {
  let cap = Math.max(0, Math.round(marketOrGlobalCapCents));
  if (maxStakeCents != null && maxStakeCents > 0) cap = Math.min(cap, Math.round(maxStakeCents));
  if (kidMode) cap = Math.min(cap, KID_MAX_STAKE_CENTS);
  return cap;
}

// ---------- invite codes ----------
/** Parent invite codes: 6 chars, digits + unambiguous uppercase (no O/0 confusion... we simply use both — families type them once). */
export function inviteCodeOk(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code ?? "");
}

/** whitelisted alphabet for generated codes (digits + letters, no 0/O/1/I) */
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const INVITE_CODE_LEN = 6;

/** Deterministic checker for a candidate alphabet index list — the server action randomly samples via crypto; this keeps the format testable. */
export function inviteCodeFromIndexes(indexes: number[]): string {
  return indexes.map((i) => INVITE_ALPHABET[((i % INVITE_ALPHABET.length) + INVITE_ALPHABET.length) % INVITE_ALPHABET.length]).join("");
}

// ---------- squad parent / pause ----------
/** Inside a squad there are exactly two ranks: ordinary "member" and "parent". */
export function squadRoleOk(raw: string | null | undefined): raw is "parent" | "member" | null {
  return raw === null || raw === undefined || raw === "parent" || raw === "member";
}

/** Kind labels for the audit log feed (EN side; UI translates via i18n keys). */
export const USER_ADMIN_ACTIONS = [
  "user.role",
  "user.ban",
  "user.unban",
  "user.forceLogout",
  "user.kidMode",
  "user.maxStake",
  "group.pause",
  "group.unpause",
  "group.inviteRotate",
  "group.inviteToggle",
  "group.parent",
  "group.transfer",
  "group.kick",
  "market.approve",
  "market.reject",
] as const;
