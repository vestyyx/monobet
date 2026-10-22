"use client";

// Daily trivia play panel — pick one of four, lock it in, celebrate or
// commiserate. Correct answers build a streak that multiplies the next
// payouts (see lib/fun.ts). The true answer index only reaches the client
// AFTER the player's own answer (locked state) — no peeking beforehand.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { triviaAnswer } from "@/lib/actions-fun";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Flame, Loader2, PartyPopper } from "lucide-react";

export type TriviaPanelProps = {
  lang: Lang;
  q: string;
  options: string[];
  difficulty: number;
  potCents: number;
  streak: number;
  answered: { chosen: number; correctIdx: number; correct: boolean; rewardCents: number } | null;
  answeredCount: number;
  correctCount: number;
};

// Difficulty dots — cozy visual instead of jargon.
function DiffDots({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn("size-1.5 rounded-full", i <= n ? "bg-warn-strong" : "bg-line-2")} />
      ))}
    </span>
  );
}

export function TriviaPanel(p: TriviaPanelProps) {
  const t = getT(p.lang);
  const router = useRouter();
  const [chosen, setChosen] = useState<number | null>(p.answered ? p.answered.chosen : null);
  const [correctIdx, setCorrectIdx] = useState<number | null>(p.answered ? p.answered.correctIdx : null);
  const [locked, setLocked] = useState(p.answered != null);
  const [earned, setEarned] = useState<number>(p.answered?.rewardCents ?? 0);
  const [pending, start] = useTransition();

  const lock = (idx: number) => {
    if (locked || pending) return;
    setChosen(idx);
    start(async () => {
      const res = await triviaAnswer(idx);
      if (!res.ok) {
        toast.error(res.error ?? "Error");
        setChosen(null);
        return;
      }
      setCorrectIdx(res.correctIdx ?? -1);
      setEarned(res.rewardCents ?? 0);
      setLocked(true);
      if (res.correct) toast.success(t.triviaRightMsg);
      else toast.error(t.triviaWrongMsg);
      router.refresh();
    });
  };

  // What a correct answer would pay right now (streak increments on the
  // correct answer itself — mult shown is the ×this-answer one).
  const multNext = Math.min(2, 1 + (p.streak + (locked && earned > 0 ? 0 : 1)) * 0.1);
  const possibleWin = Math.round(p.potCents * multNext);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="rounded-lg bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold">
          {t.triviaPot}: <span className="text-yes-strong">{fmtMonos(possibleWin, { lang: p.lang })}</span>
        </span>
        <span className="rounded-lg bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold inline-flex items-center gap-1.5">
          <Flame className={cn("size-3.5", p.streak > 0 ? "text-warn-strong" : "text-faint")} />
          {t.triviaStreak} <span className="num">{p.streak}</span>
        </span>
        <DiffDots n={p.difficulty} />
        <span className="text-[11.5px] text-faint ml-auto">{t.triviaStats(p.answeredCount, p.correctCount)}</span>
      </div>

      <h2 className="text-[17px] font-bold leading-snug text-ink">{p.q}</h2>

      <div className="mt-4 grid gap-2">
        {p.options.map((opt, i) => {
          const isRight = locked && i === correctIdx;
          const mine = chosen === i;
          if (isRight || (locked && mine)) {
            return (
              <div
                key={i}
                className={cn(
                  "rounded-xl border px-4 py-2.5 text-[13.5px] font-medium",
                  isRight ? "border-yes bg-yes-soft text-ink" : "border-no bg-no-soft text-ink"
                )}
              >
                {isRight ? "✔ " : mine ? "✕ " : ""}
                {opt}
                {isRight && mine && earned > 0 && (
                  <b className="num float-right text-yes-strong">+{fmtMonos(earned, { lang: p.lang })}</b>
                )}
              </div>
            );
          }
          if (locked) {
            return (
              <div key={i} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-[13.5px] font-medium text-mute opacity-70">
                {opt}
              </div>
            );
          }
          return (
            <button
              key={i}
              onClick={() => lock(i)}
              disabled={pending}
              className={cn(
                "text-left rounded-xl border px-4 py-2.5 text-[13.5px] font-medium transition-colors",
                mine ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand-2 hover:bg-surface-2",
                pending && "opacity-60"
              )}
            >
              <span className="text-faint mr-2 num">{["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"][i] ?? `${i}.`}</span>
              {opt}
              {pending && mine && <Loader2 className="inline size-3.5 ml-2 animate-spin" />}
            </button>
          );
        })}
      </div>

      {locked && (
        <div className={cn("mt-4 rounded-xl px-4 py-3 text-[13px] font-medium", correctIdx === chosen ? "bg-yes-soft" : "bg-no-soft")}>
          {correctIdx === chosen ? (
            <span className="inline-flex items-center gap-2">
              <PartyPopper className="size-4" /> {t.triviaRightMsg}
              {earned > 0 && <b className="num text-yes-strong">+{fmtMonos(earned, { lang: p.lang })}</b>}
            </span>
          ) : (
            t.triviaWrongMsg
          )}
        </div>
      )}
    </div>
  );
}
