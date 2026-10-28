import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Trophy, Gamepad2 } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { BracketPanel, type BracketVM } from "@/components/bracket-panel";
import { bracketList } from "@/lib/actions-fun";
import { funRoundOpen } from "@/lib/fun";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tipovačky pavouků" };

// Bracket pools — season-long prediction games: a winner per match, editable
// until the deadline, then the real results reveal the leaderboard.
export default async function BracketsPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const pools = await bracketList();

  const vms: BracketVM[] = pools.map((p) => ({
    id: p.id,
    title: p.title,
    closeAt: new Date(p.closeAt).toISOString(),
    closeLabel: fmtShort(new Date(p.closeAt), lang),
    isOpen: funRoundOpen(p.status, p.closeAt),
    status: p.status,
    matches: p.matches,
    results: p.results,
    entryCount: p.entryCount,
    myPicks: p.myPicks,
    myScore: p.myScore,
    myRewardCents: p.myRewardCents,
    rewardCents: p.rewardCents,
    leaderboard: p.leaderboard,
  }));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="size-6 text-brand" /> {t.bracketTitle}
          </h1>
          <p className="text-[13.5px] text-mute mt-1">{t.bracketSub}</p>
        </div>
        <Link href="/games" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-mute hover:text-ink transition-colors">
          <Gamepad2 className="size-4" /> {t.bracketBack}
        </Link>
      </div>

      <BracketPanel lang={lang} pools={vms} />
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
