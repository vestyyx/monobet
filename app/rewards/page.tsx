import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { getRewardsState, getWallPrayers } from "@/lib/queries";
import { accruedDebtCents } from "@/lib/loans";
import { AnimatedMoney } from "@/components/animated-number";
import { RewardsPanels } from "@/components/rewards-panels";
import { fmtMonos } from "@/lib/money";
import { activityBonusCents } from "@/lib/activity";
import {
  DAILY_COOLDOWN_MS,
  WEEKLY_COOLDOWN_MS,
  AD_COOLDOWN_MS,
  BONUSES,
} from "@/lib/rewards";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Odměny" };

export default async function RewardsPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const [state, prayers] = await Promise.all([getRewardsState(user.id), getWallPrayers()]);

  const nextAt = (last: Date | null, cd: number) =>
    last ? new Date(last).getTime() + cd : null;

  const bonusState = BONUSES.map((b) => ({
    key: b.key,
    amountCents: b.amountCents,
    href: b.href,
    claimed: state.claimed.has(`bonus:${b.key}`),
    eligible: !b.check || state.eligible[b.check],
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.rewardsTitle}</h1>
          <p className="text-[13.5px] text-mute mt-1">{t.rewardsSub}</p>
        </div>
        <div className="num text-sm font-semibold bg-surface-2 rounded-lg px-3 py-2">
          <AnimatedMoney cents={user.balanceCents} lang={lang} />
        </div>
      </div>

      <Link
        href="/jobs"
        className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:bg-surface-2"
      >
        <div>
          <div className="text-sm font-semibold">{t.jobsTitle}</div>
          <div className="mt-0.5 text-[12.5px] text-mute">{t.jobsLinkDesc}</div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-mute" />
      </Link>

      <RewardsPanels
        lang={lang}
        daily={{ nextAt: nextAt(user.lastClaimAt, DAILY_COOLDOWN_MS), amount: fmtMonos(25_000, { lang }), streak: user.claimStreak }}
        weekly={{
          nextAt: nextAt(state.lastWeekly, WEEKLY_COOLDOWN_MS),
          amount: fmtMonos(100_000, { lang }),
        }}
        ad={{ nextAt: nextAt(state.lastAd, AD_COOLDOWN_MS), amount: fmtMonos(5_000, { lang }) }}
        // getCurrentUser already rolled today's presence — activityStreak is
        // post-roll, so `today` is what this visit just paid.
        activity={{
          streak: user.activityStreak,
          today: fmtMonos(activityBonusCents(user.activityStreak), { lang }),
          next: fmtMonos(activityBonusCents(user.activityStreak + 1), { lang }),
        }}
        bonuses={bonusState}
        username={user.username ?? user.name}
        referrals={state.referrals}
        royaltyDueCents={state.royaltyDueCents}
        debt={{ cents: accruedDebtCents(user.debtCents, user.debtRateBps, user.debtSince), rateBps: user.debtRateBps }}
        wall={{ prayerAt: user.wallPrayerAt, vowBps: user.vowBps, prayers, balanceCents: user.balanceCents }}
        // eslint-disable-next-line react-hooks/purity -- server component renders once per request
        wallNow={Date.now()}
      />
    </div>
  );
}
