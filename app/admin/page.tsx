import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getAdminDashboard } from "@/lib/admin/dashboard";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Card, Badge } from "@/components/ui/primitives";
import { fmtMonos, fmtDateTime } from "@/lib/money";
import { ShieldCheck, Activity, Users, Wallet, Sprout, Zap, Swords, Inbox, ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administrace" };

// Admin dashboard — the "what's happening right now" home. Deep tooling lives
// in the registry-driven sections (sidebar); this page keeps an eye on the
// platform's pulse and surfaces warnings.
export default async function AdminDashboard() {
  const user = await requireRole("moderator");
  if (!user) redirect("/login");
  const [lang] = await Promise.all([getLang()]);
  const t = getT(lang);
  const d = await getAdminDashboard();
  void user.parsedRole;

  const stats = [
    { icon: <Activity className="size-4" />, label: t.admActiveToday, value: String(d.activeToday) },
    { icon: <Users className="size-4" />, label: t.admPlayers, value: String(d.players) },
    { icon: <Wallet className="size-4" />, label: t.admSupply, value: fmtMonos(d.supplyCents, { lang }) },
    { icon: <Zap className="size-4" />, label: t.admTradesToday, value: String(d.tradesToday) },
    { icon: <Sprout className="size-4" />, label: t.admJobsToday, value: String(d.jobsToday) },
    { icon: <Swords className="size-4" />, label: t.admDuelsToday, value: String(d.duelsToday) },
    { icon: <Inbox className="size-4" />, label: t.admPending, value: String(d.pendingMarkets), warn: d.pendingMarkets > 0 },
    { icon: <ShieldAlert className="size-4" />, label: t.admReports, value: String(d.reportsOpen), warn: d.reportsOpen > 0 },
  ];

  return (
    <div className="py-2">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <ShieldCheck className="size-5" /> {t.adminTitle}
      </h1>
      <p className="mt-1 text-[13px] text-mute">{t.admDashIntro}</p>

      {/* Warnings row — only renders when something needs eyes. */}
      {(d.pendingMarkets > 0 || d.disputedDuels > 0 || d.reportsOpen > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {d.pendingMarkets > 0 && (
            <Link href="/admin/approvals">
              <Badge tone="warn" className="cursor-pointer">{t.admWarnPending(d.pendingMarkets)}</Badge>
            </Link>
          )}
          {d.disputedDuels > 0 && (
            <Link href="/admin/moderation">
              <Badge tone="warn" className="cursor-pointer">{t.admWarnDisputes(d.disputedDuels)}</Badge>
            </Link>
          )}
          {d.reportsOpen > 0 && (
            <Link href="/admin/moderation">
              <Badge tone="no" className="cursor-pointer">{t.admWarnReports(d.reportsOpen)}</Badge>
            </Link>
          )}
        </div>
      )}

      {/* Stat grid — min-w-0 keeps long money values from overflowing phone widths. */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 [&>*]:min-w-0">
        {stats.map((s) => (
          <Card key={s.label} className="px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-faint">
              {s.icon}
              <span className="text-[10.5px] font-semibold uppercase tracking-wider truncate">{s.label}</span>
            </div>
            <div className={`num text-[18px] font-bold mt-1 ${s.warn ? "text-warn-strong" : "text-ink"}`}>{s.value}</div>
          </Card>
        ))}
      </div>

      {/* Recent money movement — the fastest way to spot anything odd. */}
      <h2 className="text-[14px] font-semibold mb-2.5 mt-7 flex items-center gap-1.5 text-ink-2">
        <Wallet className="size-4" /> {t.admRecentLedger}
      </h2>
      <Card className="overflow-hidden">
        {d.recentLedger.length === 0 ? (
          <p className="p-4 text-sm text-mute">{t.admNoLedger}</p>
        ) : (
          <div className="divide-y divide-line-2">
            {d.recentLedger.map((r) => (
              <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 min-w-0">
                <span className={`num text-[12.5px] font-bold shrink-0 ${r.amountCents >= 0 ? "text-yes-strong" : "text-no-strong"}`}>
                  {r.amountCents >= 0 ? "+" : "−"}{fmtMonos(Math.abs(r.amountCents), { lang })}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] truncate">{r.memo || r.kind}</div>
                  <div className="text-[11px] text-faint truncate">
                    {r.username ? `@${r.username}` : "—"} · {fmtDateTime(r.createdAt, lang)} · {r.kind}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
