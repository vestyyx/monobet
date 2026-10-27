import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import {
  AdminReportsPanel,
  AdminCommentDesk,
  AdminBlocklistPanel,
  type AdminReportRow,
  type AdminCommentRow,
  type AdminBlocklistRow,
} from "@/components/admin/moderation-panels";
import { Button, Card, Select, Badge } from "@/components/ui/primitives";
import { suspicionVerdict, flagOutlierGains } from "@/lib/moderation";
import { fmtMonos } from "@/lib/money";

export const dynamic = "force-dynamic";

// Moderation desk (Phase 4) — the reports queue, the comment censoring desk,
// the loose word blocklist and a suspicious-activity view. Every button here
// writes an audit row; the queue keeps the why on record for both outcomes.
export default async function AdminModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const admin = await requireRole("moderator");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);
  const sp = await searchParams;
  const status = ["open", "resolved", "dismissed", "all"].includes(sp.status ?? "") ? sp.status! : "open";

  // ---------- reports (filterable via GET, works without JS) ----------
  const reportRows = await db
    .select({
      id: schema.report.id,
      kind: schema.report.kind,
      targetId: schema.report.targetId,
      reason: schema.report.reason,
      status: schema.report.status,
      assigneeName: schema.user.username,
      reporterName: sql<string | null>`(select r2.username from "user" r2 where r2.id = ${schema.report.reporterId})`,
      createdAt: schema.report.createdAt,
      assigneeId: schema.report.assigneeId,
    })
    .from(schema.report)
    .leftJoin(schema.user, eq(schema.report.assigneeId, schema.user.id))
    .where(status === "all" ? undefined : and(eq(schema.report.status, status)))
    .orderBy(desc(schema.report.createdAt))
    .limit(80);

  const reports: AdminReportRow[] = reportRows.map((r) => ({
    id: r.id,
    kind: r.kind,
    targetId: r.targetId,
    reason: r.reason,
    status: r.status,
    assigneeName: r.assigneeName ?? null,
    reporterName: r.reporterName ?? null,
    mine: r.assigneeId === admin.id,
    createdAtMs: new Date(r.createdAt).getTime(),
  }));

  // ---------- comment desk: newest 40 comments, marked/hidden included ----------
  const commentRows = await db
    .select({
      id: schema.comment.id,
      userId: schema.comment.userId,
      body: schema.comment.body,
      hidden: schema.comment.hidden,
      createdAt: schema.comment.createdAt,
      authorName: schema.user.username,
      marketSlug: schema.market.slug,
      muted: schema.user.commentsBanned,
      mutedUntil: schema.user.commentBanUntil,
      // render stays pure: "the timeout is still running" decided by the DB clock
      mutedActive: sql<boolean>`comment_ban_until is not null and comment_ban_until > now()`,
    })
    .from(schema.comment)
    .innerJoin(schema.user, eq(schema.comment.userId, schema.user.id))
    .innerJoin(schema.market, eq(schema.comment.marketId, schema.market.id))
    .orderBy(desc(schema.comment.createdAt))
    .limit(40);

  const comments: AdminCommentRow[] = commentRows.map((c) => ({
    id: c.id,
    userId: c.userId,
    body: c.body,
    hidden: c.hidden,
    authorName: c.authorName ?? "?",
    marketSlug: c.marketSlug ?? null,
    muted: c.muted,
    mutedActive: c.mutedActive,
    createdAtMs: new Date(c.createdAt).getTime(),
  }));

  // ---------- blocklist ----------
  const patternRows = await db.select().from(schema.blocklist).orderBy(desc(schema.blocklist.createdAt)).limit(200);
  const patterns: AdminBlocklistRow[] = patternRows.map((p) => ({
    id: p.id,
    pattern: p.pattern,
    addedBy: p.addedBy,
    createdAtMs: new Date(p.createdAt).getTime(),
  }));

  // ---------- suspicious activity (signals, scored by lib/moderation) ----------
  // 1) several accounts seen behind one IP in the last 14 days
  const ipRows = await db
    .select({
      ip: schema.session.ipAddress,
      n: sql<number>`count(distinct ${schema.session.userId})::int`,
      names: sql<string>`string_agg(distinct ${schema.user.username}, ', ')`,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
    .where(sql`${schema.session.createdAt} > now() - interval '14 days' and ${schema.session.ipAddress} is not null`)
    .groupBy(schema.session.ipAddress)
    .having(sql`count(distinct ${schema.session.userId}) >= 2`)
    .orderBy(desc(sql`count(distinct ${schema.session.userId})`))
    .limit(8);

  // 2) trading velocity — players with 15+ orders in the last hour
  const velRows = await db
    .select({
      username: schema.user.username,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.trade)
    .innerJoin(schema.user, eq(schema.trade.userId, schema.user.id))
    .where(sql`${schema.trade.createdAt} > now() - interval '1 hour'`)
    .groupBy(schema.user.username)
    .having(sql`count(*) >= 15`)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  // 3) odd streaks — game/quest earnings over the last 7 days vs the group
  // median. Money ops (grants/refunds/transfers/…) are excluded — grant
  // spikes are an admin op, not a suspicious pattern.
  const GAIN_EXCLUDED = sql`(${schema.ledger.kind} not in ('grant', 'adjust', 'refund', 'reverse', 'transfer', 'deduct', 'loan', 'signup', 'ad'))`;
  const gainRows = await db
    .select({
      username: schema.user.username,
      gain: sql<number>`coalesce(sum(${schema.ledger.amountCents}), 0)::bigint`,
    })
    .from(schema.ledger)
    .innerJoin(schema.user, eq(schema.ledger.userId, schema.user.id))
    .where(sql`${schema.ledger.createdAt} > now() - interval '7 days' and ${schema.ledger.amountCents} > 0 and ${GAIN_EXCLUDED}`)
    .groupBy(schema.user.username)
    .limit(200);
  const medians = gainRows.map((g) => Number(g.gain));
  const median = medians.length
    ? [...medians].sort((a, b) => a - b)[Math.floor(medians.length / 2)]
    : 0;
  const outliers = new Set(flagOutlierGains(medians));

  type SignalRow = { level: string; text: string };
  const signals: SignalRow[] = ([
    ...ipRows.map((r) => ({
      level: suspicionVerdict({ sharedAccounts: r.n, actionsLastHour: 0, weeklyGainCents: 0, medianGainCents: 0 }).level,
      text: `${r.n}× ${t.admModSignalAccounts} (${r.ip}) — ${r.names.slice(0, 120)}`,
    })),
    ...velRows.map((r) => ({
      level: suspicionVerdict({ sharedAccounts: 1, actionsLastHour: r.n, weeklyGainCents: 0, medianGainCents: 0 }).level,
      text: `${t.admModSignalVelocity.replace("$n", String(r.n))} — @${r.username}`,
    })),
    ...gainRows.flatMap((g, i) =>
      outliers.has(i)
        ? [{
            level: suspicionVerdict({ sharedAccounts: 1, actionsLastHour: 0, weeklyGainCents: Number(g.gain), medianGainCents: median }).level,
            text: `${t.admModSignalStreak.replace("$n", fmtMonos(Number(g.gain)))} — @${g.username}`,
          }]
        : []
    ),
  ] satisfies SignalRow[]).filter((s) => s.level !== "none");

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admModTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-4">{t.admModSub}</p>

      {/* reports */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h2 className="text-[15px] font-semibold">{t.admModReports}</h2>
          <form method="GET" className="flex items-center gap-2">
            <Select name="status" defaultValue={status} className="h-8 w-[130px] text-[12.5px]">
              <option value="open">{t.admModOpen}</option>
              <option value="resolved">{t.admModResolved}</option>
              <option value="dismissed">{t.admModDismissed}</option>
              <option value="all">{t.admModAll}</option>
            </Select>
            <Button size="sm" type="submit" variant="outline">
              OK
            </Button>
          </form>
        </div>
        <AdminReportsPanel lang={lang} reports={reports} />
      </section>

      {/* comment censoring desk */}
      <section className="mb-8">
        <h2 className="text-[15px] font-semibold mb-2">{t.admModComments}</h2>
        <AdminCommentDesk lang={lang} comments={comments} />
      </section>

      {/* blocklist */}
      <section className="mb-8">
        <h2 className="text-[15px] font-semibold mb-2">{t.admModBlocklist}</h2>
        <AdminBlocklistPanel lang={lang} patterns={patterns} />
      </section>

      {/* suspicious activity */}
      <section>
        <h2 className="text-[15px] font-semibold mb-2">{t.admModSignals}</h2>
        <p className="text-[12.5px] text-mute mb-2">{t.admModSignalsSub}</p>
        {signals.length === 0 ? (
          <Card className="p-4">
            <p className="text-[12.5px] text-mute text-center">{t.admModSignalsQuiet}</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {signals.map((s, i) => (
              <Card key={i} className="p-3 flex items-center gap-2">
                <Badge tone={s.level === "high" ? "no" : "warn"}>{s.level === "high" ? t.admModSignalHigh : t.admModSignalMed}</Badge>
                <span className="text-[13px]">{s.text}</span>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
