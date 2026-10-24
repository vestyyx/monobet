"use client";

// Emoji-riddle player panels — big riddle face, three guesses per player,
// the nudge unlocks mid-round, the first solver's name goes straight into
// the title. Fixed Mony prizes via the ledger; answers never reach the client.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input, Button, Badge, Card } from "@/components/ui/primitives";
import { emojiGuess } from "@/lib/actions-fun";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { Loader2, Lightbulb, PartyPopper, Ban } from "lucide-react";

export type EmojiVM = {
  id: string;
  emoji: string;
  closeAt: string;
  closeLabel: string;
  isOpen: boolean;
  status: "open" | "settled";
  hint: string | null;
  hintUnlocked: boolean;
  myAttempts: number;
  attemptsLeft: number;
  myGuesses: string[];
  solved: boolean;
  solvedByMe: boolean;
  winnerUsername: string | null;
  answer: string | null; // settled rounds only
  rewardCents: number;
};

export function EmojiPanel({ lang, rounds }: { lang: Lang; rounds: EmojiVM[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [sending, start] = useTransition();
  const [guesses, setGuesses] = useState<Record<string, string>>({});

  const send = (id: string, attemptsLeft: number) => {
    const g = (guesses[id] ?? "").trim();
    if (!g || sending) return;
    start(async () => {
      const res = await emojiGuess(id, g);
      if (!res.ok) {
        toast.error(res.error ?? "Error");
      } else if (res.correct) {
        toast.success(t.emojiSolvedMsg);
        setGuesses((m) => ({ ...m, [id]: "" }));
      } else {
        toast.error(t.emojiWrongMsg(res.attemptsLeft ?? Math.max(0, attemptsLeft - 1)));
        setGuesses((m) => ({ ...m, [id]: "" }));
      }
      router.refresh();
    });
  };

  if (rounds.length === 0) {
    return <p className="text-[13.5px] text-mute">{t.emojiNone}</p>;
  }

  return (
    <div className="grid gap-4">
      {rounds.map((r) => {
        const settled = r.status === "settled";
        const canType = r.isOpen && !settled && r.attemptsLeft > 0;
        return (
          <Card key={r.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="text-4xl leading-none select-none">{r.emoji}</div>
              <Badge tone={r.isOpen && !settled ? "yes" : "mute"}>
                {settled ? t.emojiSettledT : r.isOpen ? `${t.emojiCloses}: ${r.closeLabel}` : t.emojiSettledT}
              </Badge>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-faint">
              <span className="font-semibold text-mute">{fmtMonos(r.rewardCents, { lang })}</span>
              {!settled && r.isOpen && (
                <span>· {r.attemptsLeft > 0 ? t.emojiAttempts(r.attemptsLeft) : t.emojiNoLeft}</span>
              )}
            </div>

            {r.hintUnlocked && r.hint && !settled && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-mute">
                <Lightbulb className="size-4 shrink-0 text-brand mt-0.5" />
                <span>
                  <span className="font-semibold text-ink">{t.emojiHint}: </span>
                  {r.hint}
                </span>
              </div>
            )}

            {settled ? (
              <div className="mt-3">
                <div className="text-[13px] text-mute">
                  <span className="font-semibold">{t.emojiAnswerWas}: </span>
                  <span className="text-brand font-semibold">{r.answer}</span>
                </div>
                {r.solved && r.winnerUsername && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-brand">
                    <PartyPopper className="size-4" /> {t.emojiSolvedBy(r.winnerUsername)}
                  </div>
                )}
                {!r.solved && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-faint">
                    <Ban className="size-4" /> {t.emojiNoLeft}
                  </div>
                )}
              </div>
            ) : r.isOpen ? (
              <div className="mt-3 flex items-center gap-2">
                <Input
                  value={guesses[r.id] ?? ""}
                  onChange={(e) => setGuesses((m) => ({ ...m, [r.id]: e.target.value }))}
                  placeholder={r.myGuesses.length ? r.myGuesses[r.myGuesses.length - 1] : "…"}
                  disabled={!canType || sending}
                  onKeyDown={(e) => e.key === "Enter" && send(r.id, r.attemptsLeft)}
                  className="num"
                />
                <Button onClick={() => send(r.id, r.attemptsLeft)} disabled={!canType || sending || !(guesses[r.id] ?? "").trim()}>
                  {sending && <Loader2 className="size-4 animate-spin" />} {t.emojiCta}
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] text-faint">{t.emojiNoLeft}</p>
            )}

            {r.solvedByMe && <p className="mt-2 text-[12.5px] font-semibold text-brand">{t.emojiSolvedMsg}</p>}
          </Card>
        );
      })}
    </div>
  );
}
