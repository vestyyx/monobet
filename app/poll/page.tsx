import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Sparkles, Gamepad2 } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { PollPanel, type PollVM } from "@/components/poll-panel";
import { pollList } from "@/lib/actions-fun";
import { funRoundOpen } from "@/lib/fun";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rodinná hlasování" };

// Family polls — the minority-wins vote. One open vote at a time is typical;
// the list also shows closed ones with their winners.
export default async function PollPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  const t = getT(lang);
  const rounds = await pollList();

  const vms: PollVM[] = rounds.map((r) => {
    const isOpen = funRoundOpen(r.status, r.closeAt);
    return {
      id: r.id,
      q: r.q,
      a: r.a,
      b: r.b,
      closeAt: new Date(r.closeAt).toISOString(),
      closeLabel: fmtShort(new Date(r.closeAt), lang),
      isOpen,
      status: r.status,
      mySide: r.mySide,
      countA: r.countA,
      countB: r.countB,
      winningSide: r.winningSide,
      myRewardCents: r.myRewardCents,
      rewardCents: r.rewardCents,
    };
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="size-6 text-brand" /> {t.pollTitle}
          </h1>
          <p className="text-[13.5px] text-mute mt-1">{t.pollSub}</p>
        </div>
        <Link href="/games" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-mute hover:text-ink transition-colors">
          <Gamepad2 className="size-4" /> {t.pollBack}
        </Link>
      </div>

      <PollPanel lang={lang} polls={vms} />
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
