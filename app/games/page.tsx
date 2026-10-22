import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Brain, Target, Sparkles, PartyPopper, ArrowRight } from "lucide-react";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Card, Badge } from "@/components/ui/primitives";
import { AnimatedMoney } from "@/components/animated-number";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Herní koutek" };

// The family games corner — free-play party games with small fixed Mony
// prizes. Built games link live; the rest are honest "coming soon" cards
// (registry-aligned: trivia & closest-guess land first, then polls, emoji,
// quests, photo).
export default async function GamesPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);

  const live = [
    {
      href: "/trivia",
      Icon: Brain,
      title: t.gamesTriviaTitle,
      desc: t.gamesTriviaDesc,
    },
    {
      href: "/guess",
      Icon: Target,
      title: t.gamesGuessTitle,
      desc: t.gamesGuessDesc,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PartyPopper className="size-6 text-brand" /> {t.gamesTitle}
          </h1>
          <p className="text-[13.5px] text-mute mt-1">{t.gamesSub}</p>
        </div>
        <div className="num text-sm font-semibold bg-surface-2 rounded-lg px-3 py-2">
          <AnimatedMoney cents={user.balanceCents} lang={lang} />
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {live.map((g) => (
          <Link key={g.href} href={g.href} className="group">
            <Card className="p-5 h-full transition-colors group-hover:border-brand">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-brand-soft text-brand p-2.5">
                  <g.Icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-[15px]">{g.title}</h2>
                    <Badge tone="yes">{t.gamesNav}</Badge>
                  </div>
                  <p className="mt-1 text-[12.5px] text-mute leading-relaxed">{g.desc}</p>
                  <span className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand">
                    {t.gamesPlayCta} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </div>
            </Card>
          </Link>
        ))}

        {/* Coming-next party games — kept as registry-aligned placeholders. */}
        <Card className="p-5 sm:col-span-2 border-dashed">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-surface-2 text-mute p-2.5">
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-[15px]">{t.gamesComingTitle}</h2>
                <Badge tone="mute">{t.gamesComingSoon}</Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-mute leading-relaxed">{t.gamesComingDesc}</p>
            </div>
          </div>
        </Card>
      </div>

      {isAdmin(user) && (
        <p className="mt-6 text-[12.5px] text-mute text-center">
          <Link href="/admin/trivia" className="underline decoration-line-2 underline-offset-2 hover:text-ink transition-colors">
            {lang === "cs" ? "Administrace her" : "Game admin"}
          </Link>
        </p>
      )}
    </div>
  );
}
