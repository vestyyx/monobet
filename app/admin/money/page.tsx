import { redirect } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { AdminMoneyPanel, type AdminPlayerRow, type AdminBatchRow, type AdminMoneyRow, type AdminSquadRow } from "@/components/admin/money-panels";
import { ADMIN_LEDGER_KINDS } from "@/lib/admin-money";

export const dynamic = "force-dynamic";

// Player money desk (Phase 2.2) — every Mony change an admin makes lands here
// through the ledger, with a reason, a role cap and an audit row.
export default async function AdminMoneyPage() {
  const admin = await requireRole("admin");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);

  // The desk serves as the player picker too, so it lists everyone (family
  // scale — far under the 500-row bulk cap).
  const userRows = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      name: schema.user.name,
      role: schema.user.role,
      balanceCents: schema.user.balanceCents,
      frozenAt: schema.user.frozenAt,
      squadId: schema.user.squadId,
    })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt))
    .limit(500);

  const squadNames = new Map<string, string>();
  const squadsRaw = await db
    .select({
      id: schema.squad.id,
      name: schema.squad.name,
      memberCount: sql<number>`count(${schema.user.id})::int`,
    })
    .from(schema.squad)
    .leftJoin(schema.user, eq(schema.user.squadId, schema.squad.id))
    .groupBy(schema.squad.id, schema.squad.name);
  for (const s of squadsRaw) squadNames.set(s.id, s.name);

  const players: AdminPlayerRow[] = userRows.map((u) => ({
    id: u.id,
    username: u.username ?? u.id.slice(0, 8),
    name: u.name ?? u.username ?? "?",
    role: u.role ?? "user",
    balanceCents: u.balanceCents,
    frozenAt: u.frozenAt ? new Date(u.frozenAt).toISOString() : null,
    squadId: u.squadId ?? null,
    squadName: u.squadId ? squadNames.get(u.squadId) ?? null : null,
  }));

  const squads: AdminSquadRow[] = squadsRaw.map((s) => ({ id: s.id, name: s.name, memberCount: s.memberCount }));

  // Recent admin-created money rows (with usernames for the feed)
  const recentRaw = await db
    .select({
      id: schema.ledger.id,
      userId: schema.ledger.userId,
      username: schema.user.username,
      amountCents: schema.ledger.amountCents,
      kind: schema.ledger.kind,
      memo: schema.ledger.memo,
      createdAt: schema.ledger.createdAt,
    })
    .from(schema.ledger)
    .innerJoin(schema.user, eq(schema.user.id, schema.ledger.userId))
    .where(inArray(schema.ledger.kind, [...ADMIN_LEDGER_KINDS]))
    .orderBy(desc(schema.ledger.createdAt))
    .limit(40);
  const recent: AdminMoneyRow[] = recentRaw.map((r) => ({
    id: r.id,
    userId: r.userId,
    username: r.username,
    amountCents: r.amountCents,
    kind: r.kind,
    memo: r.memo,
    createdAtMs: new Date(r.createdAt).getTime(),
  }));

  // Recent bulk batches (from the audit log) + whether they were undone
  const batchAudit = await db
    .select()
    .from(schema.adminAudit)
    .where(eq(schema.adminAudit.action, "money.bulkGrant"))
    .orderBy(desc(schema.adminAudit.createdAt))
    .limit(10);
  const batches: AdminBatchRow[] = [];
  for (const a of batchAudit) {
    const after = (a.after ?? {}) as { affectedCount?: number; totalCents?: number };
    const [undoneRow] = await db
      .select({ id: schema.ledger.id })
      .from(schema.ledger)
      .where(and(eq(schema.ledger.batchId, a.targetId), eq(schema.ledger.kind, "reverse")))
      .limit(1);
    batches.push({
      batchId: a.targetId,
      createdAtMs: new Date(a.createdAt).getTime(),
      reason: a.reason,
      affectedCount: after.affectedCount ?? 0,
      totalCents: after.totalCents ?? 0,
      undone: !!undoneRow,
    });
  }

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admMoneyTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admMoneySub}</p>
      <AdminMoneyPanel lang={lang} players={players} squads={squads} recent={recent} batches={batches} isOwnerOrAdmin />
    </div>
  );
}
