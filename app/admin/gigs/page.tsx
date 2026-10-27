import { redirect } from "next/navigation";
import { and, desc, eq, isNull, isNotNull, type SQL } from "drizzle-orm";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { AdminGigConfigPanel, AdminShiftDesk, type GigShiftRow } from "@/components/admin/gig-panels";
import { Button, Select, Card } from "@/components/ui/primitives";
import { DEFAULT_JOB_RATES } from "@/lib/jobs";

export const dynamic = "force-dynamic";

// Gigs desk (Phase 5, admin+). The gigs themselves are quick self-service jobs
// (dishes / math); this page tunes what they pay, the rolling 24 h earnings
// cap, and lets an admin claw back an abusive shift through the ledger.
export default async function AdminGigsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; status?: string }>;
}) {
  const admin = await requireRole("admin");
  if (!admin) redirect("/login");
  const lang = await getLang();
  const t = getT(lang);
  const sp = await searchParams;
  const job = ["dishes", "math", "all"].includes(sp.job ?? "") ? sp.job! : "all";
  const status = ["settled", "reversed", "all"].includes(sp.status ?? "") ? sp.status! : "settled";

  // Singleton rates row (seeded by the migration; falls back to defaults).
  const [cfg] = await db.select().from(schema.gigConfig).limit(1);

  // Latest settled shifts — the reversal desk works on this queue.
  const conds: SQL[] = [isNotNull(schema.jobShift.settledAt)];
  if (job !== "all") conds.push(eq(schema.jobShift.job, job));
  if (status === "settled") conds.push(isNull(schema.jobShift.reversedAt));
  if (status === "reversed") conds.push(isNotNull(schema.jobShift.reversedAt));

  const shiftRows = await db
    .select({
      id: schema.jobShift.id,
      job: schema.jobShift.job,
      username: schema.user.username,
      earnedCents: schema.jobShift.earnedCents,
      startedAt: schema.jobShift.startedAt,
      settledAt: schema.jobShift.settledAt,
      reversedAt: schema.jobShift.reversedAt,
    })
    .from(schema.jobShift)
    .innerJoin(schema.user, eq(schema.jobShift.userId, schema.user.id))
    .where(and(...conds))
    .orderBy(desc(schema.jobShift.settledAt))
    .limit(100);

  const shifts: GigShiftRow[] = shiftRows.map((s) => ({
    id: s.id,
    job: s.job,
    username: s.username,
    earnedCents: s.earnedCents,
    startedAtMs: new Date(s.startedAt).getTime(),
    settledAtMs: s.settledAt ? new Date(s.settledAt).getTime() : null,
    reversed: !!s.reversedAt,
  }));

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">{t.admGigTitle}</h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-4">{t.admGigSub}</p>

      <AdminGigConfigPanel
        lang={lang}
        config={{
          dishPayCents: cfg?.dishPayCents ?? DEFAULT_JOB_RATES.dishPayCents,
          mathPayCents: cfg?.mathPayCents ?? DEFAULT_JOB_RATES.mathPayCents,
          dailyCapCents: cfg?.dailyCapCents ?? DEFAULT_JOB_RATES.dailyCapCents,
          updatedBy: cfg?.updatedBy ?? "",
          updatedAtMs: cfg ? new Date(cfg.updatedAt).getTime() : null,
        }}
      />

      <h2 className="text-[15px] font-semibold mt-8 mb-0.5">{t.admGigDesk}</h2>
      <p className="text-[12.5px] text-mute mb-3">{t.admGigDeskSub}</p>

      {/* GET filters — shift desk */}
      <form method="GET" className="flex items-center gap-2 flex-wrap mb-3">
        <Select name="job" defaultValue={job} className="h-8 w-[160px] text-[12.5px]">
          <option value="all">{t.admModAll}</option>
          <option value="dishes">{t.jobsDishesTitle}</option>
          <option value="math">{t.jobsMathTitle}</option>
        </Select>
        <Select name="status" defaultValue={status} className="h-8 w-[140px] text-[12.5px]">
          <option value="settled">{t.admGigSettled}</option>
          <option value="reversed">{t.admGigReversed}</option>
          <option value="all">{t.admModAll}</option>
        </Select>
        <Button size="sm" type="submit" variant="outline">
          OK
        </Button>
      </form>

      <Card className="overflow-hidden">
        <AdminShiftDesk lang={lang} shifts={shifts} />
      </Card>
    </div>
  );
}
