"use client";

// Closest-guess play panel — one entry per player per round, editable until
// closeAt. After the big reveal: winners painted gold, consolation peeps too.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Badge } from "@/components/ui/primitives";
import { guessEnter } from "@/lib/actions-fun";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Loader2, Lock, Unlock } from "lucide-react";

export type GuessRoundVM = {
  id: string;
  prompt: string;
  unit: string;
  closeAt: string; // ISO from server page
  closeLabel: string; // pre-formatted server-side (locale-safe)
  isOpen: boolean; // server-computed: status open AND clock not expired
  status: "open" | "settled";
  myValue: number | null;
  entrants: number;
  answerValue: number | null; // revealed only on settled rounds
  winners: { username: string; value: number; rewardCents: number }[];
  rewardCents: number;
  consolationCents: number;
};

function OneRound({ lang, r }: { lang: Lang; r: GuessRoundVM }) {
  const t = getT(lang);
  const router = useRouter();
  const [value, setValue] = useState(r.myValue != null ? String(r.myValue) : "");
  const [pending, start] = useTransition();

  const isOpen = r.isOpen; // computed server-side — keeps render pure

  const save = () => {
    if (pending) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    start(async () => {
      const res = await guessEnter(r.id, n);
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.guessSaved);
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-2 flex-wrap">
        <Badge tone={isOpen ? "yes" : "mute"}>
          {isOpen ? <Unlock className="size-3" /> : <Lock className="size-3" />}
          {isOpen ? t.guessOpen : r.status === "settled" ? t.guessSettledT : t.guessClosedSo}
        </Badge>
        {isOpen && <span className="text-[11.5px] text-faint">{t.guessOpen}: {r.closeLabel}</span>}
        {r.status === "settled" && r.rewardCents > 0 && (
          <span className="text-[11.5px] text-faint">{t.guessWinnerLine.replace("Ɱ200", fmtMonos(r.rewardCents, { lang }))}</span>
        )}
      </div>

      <h3 className="mt-2.5 text-[15.5px] font-bold leading-snug">{r.prompt}</h3>

      {/* Entry row */}
      {isOpen ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[12.5px] text-mute shrink-0">{t.guessMine}:</span>
          <Input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="?"
            className="max-w-40 num"
          />
          {r.unit && <span className="text-[12.5px] text-faint shrink-0">{r.unit}</span>}
          <Button size="sm" onClick={save} disabled={pending} className="shrink-0">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {t.guessEnterCta}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-mute">{t.guessAnswerWas}:</span>
          <b className="num text-ink">{r.answerValue ?? "?"}</b>
          {r.unit && <span className="text-faint">{r.unit}</span>}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 flex-wrap text-[12px] text-faint">
        <span>{t.guessEntrants(r.entrants)}</span>
        {r.myValue != null && (
          <span>
            {t.guessMine}: <b className="num text-ink">{r.myValue}</b>
          </span>
        )}
      </div>

      {/* Winners row after settle */}
      {r.status === "settled" && r.winners.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5">
          <div className="text-[11.5px] font-bold uppercase tracking-wider text-faint mb-1.5">{t.guessWinners}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {r.winners.map((w, i) => (
              <span key={i} className={cn("text-[12.5px] font-semibold")}>
                @{w.username} <span className="num text-faint">({w.value})</span>{" "}
                <b className="num text-yes-strong">+{fmtMonos(w.rewardCents, { lang })}</b>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function GuessPanels({ lang, rounds }: { lang: Lang; rounds: GuessRoundVM[] }) {
  const t = getT(lang);
  if (rounds.length === 0) return <p className="text-[13.5px] text-mute">{t.guessNone}</p>;
  return (
    <div className="grid gap-3">
      {rounds.map((r) => (
        <OneRound key={r.id} lang={lang} r={r} />
      ))}
    </div>
  );
}
