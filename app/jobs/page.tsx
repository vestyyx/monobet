import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnimatedMoney } from "@/components/animated-number";
import { JobsPanel } from "@/components/jobs-panel";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { JOB_DAILY_CAP_CENTS } from "@/lib/jobs";
import { fmtMonos } from "@/lib/money";
import { getJobEarnedLast24h } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Brigády" };

export default async function JobsPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const [earnedCents] = await Promise.all([getJobEarnedLast24h(user.id)]);
  const t = getT(lang);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.jobsTitle}</h1>
          <p className="mt-1 text-[13.5px] text-mute">{t.jobsSub}</p>
        </div>
        <div className="num rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold">
          <AnimatedMoney cents={user.balanceCents} lang={lang} />
        </div>
      </div>
      <p className="mt-4 text-[13px] font-medium text-mute">
        {t.jobsToday(fmtMonos(earnedCents, { lang }), fmtMonos(JOB_DAILY_CAP_CENTS, { lang }))}
      </p>
      <JobsPanel lang={lang} />
    </div>
  );
}
