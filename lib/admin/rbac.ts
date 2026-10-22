// Admin role-based access control.
//
// Role ladder (low → high): user → moderator → admin → owner.
// The upstream super-admin email always maps to "owner" — the platform
// owner can never lock themselves out.
//
// Every admin server action must go through `requireRole()` so the check
// lives in one place and future tiers (group parent etc.) slot in here,
// not scattered across the codebase.
import { cache } from "react";
import { getCurrentUser, type CurrentUser } from "@/lib/session";
import { SUPER_ADMIN_EMAIL } from "@/lib/auth";

export type Role = "user" | "moderator" | "admin" | "owner";

// Ladder rank — a role may act when its rank ≥ the minimum the action needs.
const RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2, owner: 3 };

export function rankOf(role: Role): number {
  return RANK[role];
}

export function roleAtLeast(role: Role, min: Role): boolean {
  return rankOf(role) >= rankOf(min);
}

// Effective role of the current user. The super-admin email outranks
// whatever is stored on the account.
export function effectiveRole(u: Pick<CurrentUser, "role" | "email">): Role {
  const email = (u.email ?? "").toLowerCase();
  if (email && email === SUPER_ADMIN_EMAIL) return "owner";
  if (u.role === "owner" || u.role === "moderator" || u.role === "admin") return u.role as Role;
  return "user";
}

// Turn a stored role string into a sane Role (bad rows degrade to "user").
export function parseRole(raw: string | null | undefined): Role {
  if (raw === "owner" || raw === "moderator" || raw === "admin") return raw;
  return "user";
}

// Server-side gate for admin actions/pages. `min` is the lowest role that may
// perform the action — e.g. requireRole("moderator") for report triage,
// requireRole("admin") for money moves, requireRole("owner") for the
// most destructive settings. Signed-out users bounce to /login; users
// below the role bounce to their overview (/) — not an error they can retry.
export const requireRole = cache(async function requireRole(
  min: Role
): Promise<(CurrentUser & { parsedRole: Role }) | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  const parsed = effectiveRole(u);
  if (!roleAtLeast(parsed, min)) return null;
  return { ...u, parsedRole: parsed };
});

// Throwing variant for server actions — callers wrap in try/catch and
// surface the message through the normal toast pipeline.
export async function assertRole(min: Role): Promise<(CurrentUser & { parsedRole: Role })> {
  const g = await requireRole(min);
  if (!g) throw new Error(min === "admin" ? "Admin only" : `${min[0].toUpperCase()}${min.slice(1)} role required`);
  return g;
}
