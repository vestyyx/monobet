import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Target, Gamepad2 } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { GuessPanels, type GuessRoundVM } from "@/components/guess-panels";
import { guessList } from "@/lib/actions-fun";
import { guessRoundOpen } from "@/lib/fun";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nejbližší tip" };

// Closest guess — list of open/ongoing/just-settled rounds. Free to play;
// nothing is staked, the closest entry simply wins a fixed Mony prize.
export default async function GuessPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const rounds = await guessList();

  const vms: GuessRoundVM[] = rounds.map((r) => {
    const isOpen = guessRoundOpen(r.status, r.closeAt);
    return {
      id: r.id,
      prompt: r.prompt,
      unit: r.unit,
      closeAt: new Date(r.closeAt).toISOString(),
      closeLabel: fmtShort(new Date(r.closeAt), lang),
      isOpen,
      status: r.status,
      myValue: r.myValue,
      entrants: r.entrants,
      answerValue: r.status === "settled" ? (r.answerValue ?? null) : null,
      winners: r.winners,
      rewardCents: r.rewardCents,
      consolationCents: r.consolationCents,
    };
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="size-6 text-brand" /> {t.guessTitle}
          </h1>
          <p className="text-[13.5px] text-mute mt-1">{t.guessSub}</p>
        </div>
        <Link href="/games" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-mute hover:text-ink transition-colors">
          <Gamepad2 className="size-4" /> {t.guessBack}
        </Link>
      </div>

      <GuessPanels lang={lang} rounds={vms} />
    </div>
  );
}

function fmtShort(d: Date, lang: "cs" | "en"): string {
  return new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
