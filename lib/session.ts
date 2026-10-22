import { headers } from "next/headers";
import { cache } from "react";
import { auth, SUPER_ADMIN_EMAIL } from "@/lib/auth";
import { touchActivity, todayUtc } from "@/lib/activity";
import { SEEN_THROTTLE_MS } from "@/lib/rewards";

export type CurrentUser = {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  image: string | null;
  role: string;
  balanceCents: number;
  lastClaimAt: Date | null;
  claimStreak: number;
  lastActiveDay: string | null;
  activityStreak: number;
  lastSeenAt: Date | null;
  commentsBanned: boolean;
  commentBanUntil: Date | null;
  debtCents: number;
  debtRateBps: number;
  debtSince: Date | null;
  squadId: string | null;
  squadDebtCents: number;
  bannedAt: Date | null;
  banReason: string | null;
};

export function isAdmin(u: Pick<CurrentUser, "role" | "email"> | null | undefined): boolean {
  if (!u) return false;
  return u.role === "admin" || (u.email ?? "").toLowerCase() === SUPER_ADMIN_EMAIL;
}

// cache() dedupes within one request — the header and the page body each ask
// for the session; without it that's two DB lookups per navigation.
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & {
    role?: string;
    balanceCents?: number;
    lastClaimAt?: Date | null;
    username?: string | null;
    image?: string | null;
    bannedAt?: Date | null;
    commentsBanned?: boolean;
    commentBanUntil?: Date | null;
    claimStreak?: number;
    lastActiveDay?: string | null;
    activityStreak?: number;
    lastSeenAt?: Date | null;
    debtCents?: number;
    debtRateBps?: number;
    debtSince?: Date | null;
    squadId?: string | null;
    squadDebtCents?: number;
    banReason?: string | null;
  };
  // Presence roll — first hit of a UTC day pays the streak bonus and stamps
  // last_seen. Best-effort: a failed write must not take the page down, and
  // the returned user is patched so pages don't render pre-roll values.
  let active = { lastActiveDay: u.lastActiveDay ?? null, activityStreak: u.activityStreak ?? 0, lastSeenAt: u.lastSeenAt ?? null, creditedCents: 0 };
  const seenStale = !active.lastSeenAt || Date.now() - new Date(active.lastSeenAt).getTime() > SEEN_THROTTLE_MS;
  // Banned accounts view only — skip the presence roll entirely: no daily
  // bonus credit, no last_seen stamp.
  if (!u.bannedAt && (active.lastActiveDay !== todayUtc() || seenStale)) {
    try {
      active = await touchActivity(u.id);
    } catch {
      /* presence is best-effort */
    }
  }
  return {
    id: u.id,
    name: u.name,
    username: u.username ?? null,
    email: u.email ?? null,
    image: u.image ?? null,
    role: u.email?.toLowerCase() === SUPER_ADMIN_EMAIL ? "admin" : (u.role ?? "user"),
    balanceCents: (u.balanceCents ?? 0) + active.creditedCents,
    lastClaimAt: u.lastClaimAt ?? null,
    claimStreak: u.claimStreak ?? 0,
    lastActiveDay: active.lastActiveDay,
    activityStreak: active.activityStreak,
    lastSeenAt: active.lastSeenAt,
    commentsBanned: u.commentsBanned ?? false,
    commentBanUntil: u.commentBanUntil ?? null,
    debtCents: u.debtCents ?? 0,
    debtRateBps: u.debtRateBps ?? 0,
    debtSince: u.debtSince ?? null,
    squadId: u.squadId ?? null,
    squadDebtCents: u.squadDebtCents ?? 0,
    bannedAt: u.bannedAt ?? null,
    banReason: u.banReason ?? null,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new Error("Sign in required");
  // Read-only accounts: every server action funnels through here, so this one
  // check blocks trades, games, comments, votes — the banned user can only view.
  if (u.bannedAt) throw new Error("Account suspended");
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!isAdmin(u)) throw new Error("Admin only");
  return u;
}
