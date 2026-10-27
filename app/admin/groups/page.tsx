import { redirect } from "next/navigation";
import { desc, inArray, isNotNull } from "drizzle-orm";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { AdminGroupsPanel, type AdminSquadGroupRow } from "@/components/admin/user-panels";

export const dynamic = "force-dynamic";

// Groups desk (Phase 3) — every squad with its pot, members, invite code,
// parent, pause switch and ownership. All actions audited.
export default async function AdminGroupsPage() {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);

  const squadRows = await db.select().from(schema.squad).orderBy(desc(schema.squad.createdAt)).limit(200);

  // Members (family scale — everyone with a squad fits in memory)
  const memberRows = await db
    .select({ id: schema.user.id, username: schema.user.username, squadId: schema.user.squadId, squadRole: schema.user.squadRole })
    .from(schema.user)
    .where(isNotNull(schema.user.squadId));

  // Owner usernames for the created_by links
  const ownerIds = [...new Set(squadRows.map((s) => s.createdBy).filter((x): x is string => !!x))];
  const owners = ownerIds.length
    ? await db.select({ id: schema.user.id, username: schema.user.username }).from(schema.user).where(inArray(schema.user.id, ownerIds))
    : [];
  const ownerName = new Map(owners.map((o) => [o.id, o.username ?? ""]));

  const squads: AdminSquadGroupRow[] = squadRows.map((s) => ({
    id: s.id,
    name: s.name,
    treasuryCents: s.treasuryCents,
    createdAtMs: new Date(s.createdAt).getTime(),
    pausedAt: s.pausedAt ? new Date(s.pausedAt).toISOString() : null,
    inviteCode: s.inviteCode ?? null,
    inviteEnabled: s.inviteEnabled,
    ownerUsername: s.createdBy ? ownerName.get(s.createdBy) ?? null : null,
    members: memberRows
      .filter((m) => m.squadId === s.id)
      .map((m) => ({ id: m.id, username: m.username ?? "?", squadRole: m.squadRole ?? null })),
  }));

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admGroupsTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admGroupsSub}</p>
      <AdminGroupsPanel lang={lang} squads={squads} />
    </div>
  );
}
