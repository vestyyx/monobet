import { redirect } from "next/navigation";
import { and, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { AdminPlayersPanel, type AdminUserRow } from "@/components/admin/user-panels";
import { Button, Input, Select } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

// Players desk (Phase 3) — accounts, roles, limits and suspensions. Every
// quick action here writes an audit row; temp bans carry a mandatory reason.
export default async function AdminPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string }>;
}) {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);
  const sp = await searchParams;

  // Server-side filtering via plain GET params (same pattern as the audit log).
  const conds: SQL[] = [];
  if (sp.q) conds.push(or(ilike(schema.user.username, `%${sp.q}%`), ilike(schema.user.name, `%${sp.q}%`))!);
  if (sp.role) conds.push(eq(schema.user.role, sp.role));
  if (sp.status === "frozen") conds.push(isNotNull(schema.user.frozenAt));
  if (sp.status === "banned") conds.push(isNotNull(schema.user.bannedAt));
  if (sp.status === "kid") conds.push(eq(schema.user.kidMode, true));
  if (sp.status === "active") conds.push(and(isNull(schema.user.bannedAt), isNull(schema.user.frozenAt))!);

  const rows = await db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      kidMode: schema.user.kidMode,
      maxStakeCents: schema.user.maxStakeCents,
      frozenAt: schema.user.frozenAt,
      bannedAt: schema.user.bannedAt,
      bannedUntil: schema.user.bannedUntil,
      banReason: schema.user.banReason,
      createdAt: schema.user.createdAt,
      balanceCents: schema.user.balanceCents,
      squadName: schema.squad.name,
      // "still banned" flag decided by the DB clock (render stays pure)
      suspended: sql<boolean>`banned_at is not null and (banned_until is null or banned_until > now())`,
    })
    .from(schema.user)
    .leftJoin(schema.squad, eq(schema.user.squadId, schema.squad.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.user.createdAt))
    .limit(300);

  const users: AdminUserRow[] = rows.map((u) => ({
    id: u.id,
    username: u.username ?? t.admPlayersNotFound,
    name: u.name,
    email: u.email,
    role: u.role,
    kidMode: u.kidMode,
    maxStakeCents: u.maxStakeCents ?? null,
    frozenAt: u.frozenAt ? new Date(u.frozenAt).toISOString() : null,
    bannedAt: u.bannedAt ? new Date(u.bannedAt).toISOString() : null,
    bannedUntil: u.bannedUntil ? new Date(u.bannedUntil).toISOString() : null,
    banReason: u.banReason ?? null,
    suspended: u.suspended,
    createdAtMs: new Date(u.createdAt).getTime(),
    squadName: u.squadName ?? null,
    balanceCents: u.balanceCents,
  }));

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admPlayersTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-4">{t.admPlayersSub}</p>

      {/* GET filters — work without JS, shared with the panel's local search */}
      <form method="GET" className="flex items-center gap-2 flex-wrap mb-4">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder={t.admPlayersQ} className="h-8 w-[200px] text-[12.5px]" />
        <Select name="role" defaultValue={sp.role ?? ""} className="h-8 w-[140px] text-[12.5px]">
          <option value="">{t.admPlayersRole} {t.admPlayersAny}</option>
          <option value="user">{t.admPlayersStd}</option>
          <option value="moderator">{t.admPlayersModerator}</option>
          <option value="admin">{t.admPlayersAdmin}</option>
          <option value="owner">{t.admPlayersOwner}</option>
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="h-8 w-[140px] text-[12.5px]">
          <option value="">{t.admPlayersStatus} {t.admPlayersAny}</option>
          <option value="active">{t.admPlayersActive}</option>
          <option value="frozen">{t.admPlayersFrozen}</option>
          <option value="banned">{t.admPlayersBanned}</option>
          <option value="kid">{t.admPlayersKid}</option>
        </Select>
        <Button size="sm" type="submit" variant="outline">
          OK
        </Button>
      </form>

      <AdminPlayersPanel lang={lang} players={users} />
    </div>
  );
}
