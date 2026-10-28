"use client";

// Bracket-pool player panel — tip a winner for every match while the pool is
// open (freely editable until the deadline), then watch the leaderboard fill
// in once the real winners are revealed. Fixed Mony prizes, nothing staked.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, Badge, Input, Button } from "@/components/ui/primitives";
import { bracketSubmit } from "@/lib/actions-fun";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { Loader2, Check, X, Trophy } from "lucide-react";

export type BracketVM = {
  id: string;
  title: string;
  closeAt: string;
  closeLabel: string;
  isOpen: boolean;
  status: "open" | "settled";
  matches: { label: string; points: number }[];
  results: string[] | null;
  entryCount: number;
  myPicks: Record<string, string> | null;
  myScore: number | null;
  myRewardCents: number | null;
  rewardCents: number;
  leaderboard: { username: string; score: number; rewardCents: number }[];
};

export function BracketPanel({ lang, pools }: { lang: Lang; pools: BracketVM[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  // Local drafts per pool — seeded from the saved picks, replaced on edit.
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  const save = (id: string) => {
    if (pending) return;
    start(async () => {
      const res = await bracketSubmit(id, drafts[id] ?? {});
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.bracketSaved);
        router.refresh();
      }
    });
  };

  if (pools.length === 0) {
    return <p className="text-[13.5px] text-mute">{t.bracketNone}</p>;
  }

  return (
    <div className="grid gap-4">
      {pools.map((p) => {
        const draft = drafts[p.id] ?? p.myPicks ?? {};
        const filled = p.matches.every((_, i) => (draft[String(i)] ?? "").trim().length > 0);
        const mineSaved = p.myPicks != null;
        return (
          <Card key={p.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold text-[15px] leading-snug">{p.title}</h2>
              <Badge tone={p.isOpen ? "yes" : p.status === "settled" ? "ink" : "warn"}>
                {p.isOpen ? `${t.bracketCloses}: ${p.closeLabel}` : p.status === "settled" ? t.bracketSettledT : t.bracketClosedSo}
              </Badge>
            </div>

            <div className="mt-3 text-[12px] text-faint flex flex-wrap items-center gap-2">
              <span>{t.bracketPrizeLine(fmtMonos(p.rewardCents, { lang }))}</span>
              <span>· {t.bracketEntries(p.entryCount)}</span>
              {p.status === "settled" && p.myScore != null && <span>· <span className="font-semibold text-mute">{t.bracketMyScore(p.myScore)}</span></span>}
              {p.myRewardCents != null && p.myRewardCents > 0 && <span className="text-brand font-semibold">+{fmtMonos(p.myRewardCents, { lang })}</span>}
            </div>

            <div className="mt-4 grid gap-2">
              {p.matches.map((m, i) => {
                const winner = p.results?.[i] ?? null;
                const isHit = winner != null && mineSaved && (p.myPicks?.[String(i)] ?? "") === winner;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-xl border border-line-2 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate">{m.label}</div>
                      {winner != null && (
                        <div className="text-[11.5px] text-faint mt-0.5 flex items-center gap-1.5">
                          {isHit ? <Check className="size-3.5 text-brand" /> : <X className="size-3.5 text-faint" />}
                          <span>
                            {t.bracketWinnerLabel}: <span className="font-semibold text-mute">{winner}</span>
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] text-faint num shrink-0">{t.bracketPts(m.points)}</div>
                    {p.isOpen ? (
                      <Input
                        value={draft[String(i)] ?? ""}
                        placeholder={t.bracketMatchPh}
                        maxLength={60}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [p.id]: { ...(d[p.id] ?? p.myPicks ?? {}), [String(i)]: e.target.value } }))
                        }
                        className="w-44 shrink-0"
                      />
                    ) : mineSaved ? (
                      <div className="text-[12.5px] text-mute truncate w-44 shrink-0 text-right">{p.myPicks?.[String(i)] ?? "—"}</div>
                    ) : (
                      <div className="text-[12px] text-faint w-44 shrink-0 text-right">—</div>
                    )}
                  </div>
                );
              })}
            </div>

            {p.isOpen && (
              <div className="mt-4 flex items-center gap-3">
                <Button onClick={() => save(p.id)} disabled={pending || !filled}>
                  {pending && <Loader2 className="size-4 animate-spin" />} <Check className="size-4" /> {t.bracketSaveCta}
                </Button>
                {mineSaved && <span className="text-[12px] text-faint">{t.bracketMyPicks}</span>}
              </div>
            )}

            {p.status === "settled" && p.leaderboard.length > 0 && (
              <div className="mt-4 border-t border-line-2 pt-3">
                <div className="text-[12px] font-semibold text-mute flex items-center gap-1.5 mb-2">
                  <Trophy className="size-4 text-brand" /> {t.bracketLeaderboard}
                </div>
                <div className="grid gap-1.5">
                  {p.leaderboard.map((row, i) => (
                    <div key={`${row.username}:${i}`} className="flex items-center gap-2 text-[13px]">
                      <span className="num text-faint w-5">{i + 1}.</span>
                      <span className="font-medium truncate">@{row.username}</span>
                      <span className="text-[11.5px] text-faint num">{t.bracketPts(row.score)}</span>
                      {row.rewardCents > 0 && <span className="text-brand font-semibold text-[12px] num">+{fmtMonos(row.rewardCents, { lang })}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
