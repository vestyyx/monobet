"use client";

// Photo-guess player panels â€” the macro-shot race mirror of the emoji
// riddles: big photo, three guesses, nudge unlocks mid-round, first solver
// settles it. Answers never ship to the client while the round is open.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input, Button, Badge, Card } from "@/components/ui/primitives";
import { photoGuess, type PhotoView } from "@/lib/actions-fun";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { Loader2, Lightbulb, PartyPopper, Ban } from "lucide-react";

export type PhotoVM = PhotoView & { isOpen: boolean; closeLabel: string };

export function PhotoPanel({ lang, rounds }: { lang: Lang; rounds: PhotoVM[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [sending, start] = useTransition();
  const [guesses, setGuesses] = useState<Record<string, string>>({});

  const send = (id: string, attemptsLeft: number) => {
    const g = (guesses[id] ?? "").trim();
    if (!g || sending) return;
    start(async () => {
      const res = await photoGuess(id, g);
      if (!res.ok) {
        toast.error(res.error ?? "Error");
      } else if (res.correct) {
        toast.success(t.photoSolvedMsg);
        setGuesses((m) => ({ ...m, [id]: "" }));
      } else {
        toast.error(t.photoWrongMsg(res.attemptsLeft ?? Math.max(0, attemptsLeft - 1)));
        setGuesses((m) => ({ ...m, [id]: "" }));
      }
      router.refresh();
    });
  };

  if (rounds.length === 0) {
    return <p className="text-[13.5px] text-mute">{t.photoNone}</p>;
  }

  return (
    <div className="grid gap-4">
      {rounds.map((r) => {
        const settled = r.status === "settled";
        const canType = r.isOpen && !settled && r.attemptsLeft > 0;
        return (
          <Card key={r.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.imageData} alt="" className="rounded-xl border border-line-2 max-h-64 object-cover" />
              <Badge tone={r.isOpen && !settled ? "yes" : "mute"}>
                {settled ? t.photoSettledT : `${t.photoCloses}: ${r.closeLabel}`}
              </Badge>
            </div>
            <h2 className="mt-3 font-semibold text-[15px]">{r.q}</h2>

            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-faint">
              <span className="font-semibold text-mute">{fmtMonos(r.rewardCents, { lang })}</span>
              {!settled && r.isOpen && <span>Â· {r.attemptsLeft > 0 ? t.photoAttempts(r.attemptsLeft) : t.photoNoLeft}</span>}
            </div>

            {r.hintUnlocked && r.hint && !settled && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-mute">
                <Lightbulb className="size-4 shrink-0 text-brand mt-0.5" />
                <span>
                  <span className="font-semibold text-ink">{t.photoHint}: </span>
                  {r.hint}
                </span>
              </div>
            )}

            {settled ? (
              <div className="mt-3">
                <div className="text-[13px] text-mute">
                  <span className="font-semibold">{t.photoAnswerWas}: </span>
                  <span className="text-brand font-semibold">{r.answer}</span>
                </div>
                {r.solved && r.winnerUsername && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-brand">
                    <PartyPopper className="size-4" /> {t.photoSolvedBy(r.winnerUsername)}
                  </div>
                )}
                {!r.solved && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-faint">
                    <Ban className="size-4" /> {t.photoNoLeft}
                  </div>
                )}
              </div>
            ) : r.isOpen ? (
              <div className="mt-3 flex items-center gap-2">
                <Input
                  value={guesses[r.id] ?? ""}
                  onChange={(e) => setGuesses((m) => ({ ...m, [r.id]: e.target.value }))}
                  placeholder={r.myGuesses.length ? r.myGuesses[r.myGuesses.length - 1] : "â€¦"}
                  disabled={!canType || sending}
                  onKeyDown={(e) => e.key === "Enter" && send(r.id, r.attemptsLeft)}
                  className="num"
                />
                <Button onClick={() => send(r.id, r.attemptsLeft)} disabled={!canType || sending || !(guesses[r.id] ?? "").trim()}>
                  {sending && <Loader2 className="size-4 animate-spin" />} {t.photoCta}
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] text-faint">{t.photoNoLeft}</p>
            )}

            {r.solvedByMe && <p className="mt-2 text-[12.5px] font-semibold text-brand">{t.photoSolvedMsg}</p>}
          </Card>
        );
      })}
    </div>
  );
}
