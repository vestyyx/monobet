"use client";

// Family-poll player panels — vote A/B (and switch), see live tallies, and
// the winners line once the minority takes it. All rewards are fixed Mony
// prizes paid through the ledger; nothing is staked.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, Badge } from "@/components/ui/primitives";
import { pollVoteRound } from "@/lib/actions-fun";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { Loader2, Check } from "lucide-react";

export type PollVM = {
  id: string;
  q: string;
  a: string;
  b: string;
  closeAt: string;
  closeLabel: string;
  isOpen: boolean;
  status: "open" | "settled";
  mySide: "a" | "b" | null;
  countA: number;
  countB: number;
  winningSide: "a" | "b" | "both" | null; // settled rounds only
  myRewardCents: number | null;
  rewardCents: number;
};

export function PollPanel({ lang, polls }: { lang: Lang; polls: PollVM[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [voting, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const vote = (id: string, side: "a" | "b") => {
    setBusy(`${id}:${side}`);
    start(async () => {
      const res = await pollVoteRound(id, side);
      setBusy(null);
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.pollVoted);
        router.refresh();
      }
    });
  };

  if (polls.length === 0) {
    return <p className="text-[13.5px] text-mute">{t.pollNone}</p>;
  }

  return (
    <div className="grid gap-4">
      {polls.map((p) => {
        const total = p.countA + p.countB;
        const pctA = total ? Math.round((p.countA / total) * 100) : 0;
        const pctB = total ? 100 - pctA : 0;
        const winnerIsA = p.winningSide === "a" || p.winningSide === "both";
        const winnerIsB = p.winningSide === "b" || p.winningSide === "both";
        return (
          <Card key={p.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold text-[15px] leading-snug">{p.q}</h2>
              <Badge tone={p.isOpen ? "yes" : "mute"}>{p.isOpen ? `${t.pollCloses}: ${p.closeLabel}` : t.pollSettledT}</Badge>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => {
                const side = i === 0 ? "a" : "b";
                const label = side === "a" ? p.a : p.b;
                const count = side === "a" ? p.countA : p.countB;
                const pct = side === "a" ? pctA : pctB;
                const isMine = p.mySide === side;
                const isWinner = p.status === "settled" && (side === "a" ? winnerIsA : winnerIsB);
                const pendingClick = voting && busy === `${p.id}:${side}`;
                return (
                  <button
                    key={side}
                    onClick={() => vote(p.id, side)}
                    disabled={!p.isOpen || voting}
                    className={`
                      text-left rounded-xl border p-4 transition-colors relative
                      ${isMine ? "border-brand bg-brand-soft" : "border-line-2 hover:border-brand"}
                      ${!p.isOpen ? "opacity-95 cursor-default" : "cursor-pointer"}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      {pendingClick && <Loader2 className="size-4 animate-spin text-brand" />}
                      {isMine && !pendingClick && <Check className="size-4 text-brand" />}
                      <span className="font-semibold text-[14px]">{label}</span>
                      {isWinner && <Badge tone="yes">{t.pollWinners}</Badge>}
                    </div>
                    <div className="mt-2 text-[12px] text-mute num">
                      {count} {t.pollVotesA}
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 text-[12px] text-faint flex flex-wrap items-center gap-2">
              <span className="font-semibold text-mute">{t.pollWinnerLine}</span>
              {p.status === "settled" && p.winningSide && (
                <span>
                  · {t.pollPayout(fmtMonos(p.rewardCents, { lang }))}
                  {p.myRewardCents != null && p.myRewardCents > 0 && <span className="text-brand font-semibold"> +{fmtMonos(p.myRewardCents, { lang })}</span>}
                </span>
              )}
              {p.mySide && p.isOpen && <span>· {t.pollMyVote}: {p.mySide.toUpperCase()}</span>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
