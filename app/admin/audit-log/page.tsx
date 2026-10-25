import { redirect } from "next/navigation";
import { and, desc, like, lt } from "drizzle-orm";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { Badge, Button, Card, Input, Select } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/money";

export const dynamic = "force-dynamic";

function fmtJson(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
}

const TONE_BY_PREFIX: Record<string, "yes" | "no" | "warn" | "ink" | "mute"> = {
  money: "warn",
  user: "ink",
  game: "yes",
};

// Audit-log page (Phase 2.2): append-only records of every admin action.
// Server-rendered filtering via plain GET params — works without JS.
export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ family?: string; admin?: string; before?: string }>;
}) {
  const admin = await requireRole("admin");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);
  const sp = await searchParams;

  // Families the filters offer — derived from the page's rows below.

  const conds = [];
  if (sp.family) conds.push(like(schema.adminAudit.action, `${sp.family}.%`));
  if (sp.admin) conds.push(like(schema.adminAudit.adminName, `%${sp.admin}%`));
  if (sp.before) {
    const d = new Date(sp.before);
    if (!Number.isNaN(d.getTime())) conds.push(lt(schema.adminAudit.createdAt, d));
  }

  const rows = await db
    .select()
    .from(schema.adminAudit)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.adminAudit.createdAt))
    .limit(201);
  const page = rows.slice(0, 200);
  const more = rows.length > 200;

  // families actually present on this page (cheap + good enough for the filter)
  const families = [...new Set(page.map((r) => r.action.split(".")[0]))].sort();
  const oldest = page.length ? new Date(page[page.length - 1].createdAt) : null;

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admAuditTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">{t.admAuditSub}</p>

      <Card className="p-4 mb-4">
        <form method="get" className="grid gap-2 sm:grid-cols-[220px_220px_1fr_auto] items-end">
          <div>
            <label className="text-[11.5px] font-semibold text-mute block mb-1">{t.admAuditFamily}</label>
            <Select name="family" defaultValue={sp.family ?? ""}>
              <option value="">{t.admAuditAny}</option>
              {families.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-mute block mb-1">{t.admAuditAdmin}</label>
            <Input name="admin" defaultValue={sp.admin ?? ""} placeholder="@" />
          </div>
          <div />
          <Button type="submit">{t.admAuditFilter}</Button>
        </form>
      </Card>

      {page.length === 0 ? (
        <Card className="p-5 text-[13px] text-mute">{t.admAuditNothing}</Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-line-2">
            {page.map((r) => {
              const fam = r.action.split(".")[0];
              return (
                <div key={r.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone={TONE_BY_PREFIX[fam] ?? "mute"}>{r.action}</Badge>
                    <span className="text-[12px] font-medium">{r.adminName}</span>
                    <span className="text-[11px] text-mute">
                      → {r.targetType}:{r.targetId.slice(0, 8)}
                    </span>
                    <span className="ml-auto text-[11px] text-mute">{fmtDateTime(new Date(r.createdAt), lang)}</span>
                  </div>
                  <div className="text-[12px] mt-1">{r.reason}</div>
                  <div className="text-[11px] text-mute mt-0.5 font-mono break-all">
                    {fmtJson(r.before)} <span className="text-mute/60">→</span> {fmtJson(r.after)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="mt-3 flex gap-3 text-[12.5px]">
        {more && oldest && (
          <a className="text-brand hover:underline" href={`/admin/audit-log?before=${encodeURIComponent(oldest.toISOString())}${sp.family ? `&family=${encodeURIComponent(sp.family)}` : ""}${sp.admin ? `&admin=${encodeURIComponent(sp.admin)}` : ""}`}>
            {t.admAuditOlder}
          </a>
        )}
        {sp.before && <a className="text-mute hover:underline" href={`/admin/audit-log`}>{t.admAuditNewer}</a>}
      </div>
    </div>
  );
}
