import { redirect } from "next/navigation";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { getHouseStats, getReconciliation, getConfigVersions } from "@/lib/queries";
import { HousePanel } from "@/components/admin-panels";
import {
  AdminReconPanel,
  AdminGainAlerts,
  AdminConfigVersionsPanel,
  type ConfigVersionRow,
} from "@/components/admin/config-panels";
import { Card } from "@/components/ui/primitives";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { flagOutlierGains } from "@/lib/moderation";
import { Download } from "lucide-react";

export const dynamic = "force-dynamic";

const GAIN_EXCLUDED = sql`(${schema.ledger.kind} not in ('grant', 'adjust', 'refund', 'reverse', 'transfer', 'deduct', 'loan', 'signup', 'ad'))`;

// House & economy (Phase 5 + 6, admin+) — the house panel with its
// leverage/spend knobs and rules (saves audited + versioned since Phase 6),
// plus the books check: Σ ledger vs Σ balances, abnormal weekly earnings, the
// config snapshot history with rollback, and CSV exports for the ledger.
export default async function AdminEconomyPage() {
  const admin = await requireRole("admin");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);
  const [stats, recon, versions, gainRows] = await Promise.all([
    getHouseStats(),
    getReconciliation(),
    getConfigVersions(),
    db
      .select({
        username: schema.user.username,
        gain: sql<number>`coalesce(sum(${schema.ledger.amountCents}), 0)::bigint`,
      })
      .from(schema.ledger)
      .innerJoin(schema.user, eq(schema.ledger.userId, schema.user.id))
      .where(
        sql`${schema.ledger.createdAt} > now() - interval '7 days' and ${schema.ledger.amountCents} > 0 and ${GAIN_EXCLUDED}`
      )
      .groupBy(schema.user.username)
      .limit(200),
  ]);
  // Same median-relative scorer the moderation desk uses — flag rather than
  // paginate: with a family-sized board this stays a handful of rows.
  const gains = gainRows.map((g) => Number(g.gain));
  const flagged = new Set(flagOutlierGains(gains));
  const alerts = gainRows
    .filter((_, i) => flagged.has(i))
    .map((g) => ({ username: g.username ?? "?", gainCents: Number(g.gain) }))
    .sort((a, b) => b.gainCents - a.gainCents);

  const versionRows: ConfigVersionRow[] = versions.map((v) => ({
    id: v.id,
    changedByName: v.changedByName,
    note: v.note,
    createdAtMs: new Date(v.createdAt).getTime(),
    knobs: (v.data ?? {}) as Record<string, number>,
  }));

  return (
    <div className="py-2 space-y-5">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight">{t.econTitle}</h1>
        <p className="text-[12.5px] text-mute mt-0.5">{t.econSub}</p>
      </div>

      <Card className="max-w-3xl overflow-hidden">
        <HousePanel stats={stats} lang={lang} />
      </Card>

      <div>
        <h2 className="text-[15px] font-semibold mb-2">{t.econReconTitle}</h2>
        <Card className="max-w-3xl overflow-hidden p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <p className="text-[11.5px] text-faint">{t.econReconNote}</p>
            <div className="flex gap-2">
              {/* Plain <a> on purpose — these are CSV downloads, not pages. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/admin/economy/export/ledger"
                className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline"
              >
                <Download className="size-3.5" /> {t.econExLedger}
              </a>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/admin/economy/export/balances"
                className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline"
              >
                <Download className="size-3.5" /> {t.econExBalances}
              </a>
            </div>
          </div>
          <AdminReconPanel
            lang={lang}
            ledgerSum={recon.ledgerSumCents}
            balanceSum={recon.balanceSumCents}
            broken={recon.broken.map((b) => ({ username: b.username, diffCents: b.diffCents }))}
          />
        </Card>
      </div>

      <div>
        <h2 className="text-[15px] font-semibold mb-2">{t.econAlerts}</h2>
        <Card className="max-w-3xl overflow-hidden p-4">
          <AdminGainAlerts lang={lang} alerts={alerts} />
        </Card>
      </div>

      <div>
        <h2 className="text-[15px] font-semibold mb-2">{t.econVersions}</h2>
        <p className="text-[11.5px] text-faint mt-0.5 mb-2">{t.econVersionsNote}</p>
        <Card className="max-w-3xl overflow-hidden p-4">
          <AdminConfigVersionsPanel lang={lang} versions={versionRows} />
        </Card>
      </div>
    </div>
  );
}
