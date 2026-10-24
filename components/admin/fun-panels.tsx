"use client";

// Admin panels for the friendly games (batch 1): trivia bank curator +
// closest-guess round manager with the settle/reveal action.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Input, Select, Badge, Card } from "@/components/ui/primitives";
import { adminFunCreateTriviaQuestion, adminFunCreateGuessRound, adminFunCreatePoll, adminFunCreateEmojiRound, guessSettle, pollSettle, emojiReveal } from "@/lib/actions-fun";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { Loader2, Coins, Target } from "lucide-react";

// ---------- trivia bank ----------
export type TriviaBankRow = {
  id: string;
  qCs: string;
  qEn: string;
  correctCs: string; // resolved option text for display
  difficulty: number;
  rewardCents: number; // derived from difficulty for display
  shownDay: string | null;
};

export function AdminTriviaPanel({ lang, bank }: { lang: Lang; bank: TriviaBankRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qCs, setQCs] = useState("");
  const [qEn, setQEn] = useState("");
  const [oCs, setOCs] = useState("");
  const [oEn, setOEn] = useState("");
  const [correctIdx, setCorrectIdx] = useState("1");
  const [difficulty, setDifficulty] = useState("1");

  const submit = () => {
    if (pending) return;
    start(async () => {
      const res = await adminFunCreateTriviaQuestion({
        qCs,
        qEn,
        optionsCs: oCs.split(",").map((s) => s.trim()).filter(Boolean),
        optionsEn: oEn.split(",").map((s) => s.trim()).filter(Boolean),
        correctIdx: parseInt(correctIdx, 10) - 1,
        difficulty: parseInt(difficulty, 10),
      });
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.savedToast);
        setQCs(""); setQEn(""); setOCs(""); setOEn("");
        router.refresh();
      }
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-semibold text-[15px] mb-1 flex items-center gap-2">
          <Coins className="size-4 text-brand" /> {t.admTriviaAdd}
        </h2>
        <p className="text-[12px] text-mute mb-4">{t.admTriviaSub}</p>
        <div className="grid gap-3">
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admTriviaQCs}</label>
            <Input value={qCs} onChange={(e) => setQCs(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admTriviaQEn}</label>
            <Input value={qEn} onChange={(e) => setQEn(e.target.value)} className="mt-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admTriviaOptionsCs}</label>
              <Input value={oCs} onChange={(e) => setOCs(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admTriviaOptionsEn}</label>
              <Input value={oEn} onChange={(e) => setOEn(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admTriviaCorrect}</label>
              <Select value={correctIdx} onChange={(e) => setCorrectIdx(e.target.value)} className="mt-1">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </Select>
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admTriviaDifficulty}</label>
              <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="mt-1">
                <option value="1">{t.admTriviaDiff1}</option>
                <option value="2">{t.admTriviaDiff2}</option>
                <option value="3">{t.admTriviaDiff3}</option>
              </Select>
            </div>
          </div>
          <div>
            <Button onClick={submit} disabled={pending || !qCs.trim() || !qEn.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />} {t.admTriviaAdd}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5 overflow-hidden">
        <h2 className="font-semibold text-[15px] mb-3">{t.admTriviaBank}</h2>
        {bank.length === 0 ? (
          <p className="text-[13px] text-mute">{t.admTriviaBankEmpty}</p>
        ) : (
          <div className="divide-y divide-line-2 max-h-[520px] overflow-y-auto">
            {bank.map((q) => (
              <div key={q.id} className="py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{q.qCs}</div>
                    <div className="text-[11.5px] text-faint truncate">{q.qEn}</div>
                  </div>
                  <Badge tone="mute">Ɱ{Math.round(q.rewardCents / 100)}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11.5px] text-faint">
                  <span>✔ {q.correctCs}</span>
                  {q.shownDay && (
                    <span className="text-brand font-semibold">
                      {t.admTriviaShown} {q.shownDay}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- guess rounds ----------
export type GuessAdminRow = {
  id: string;
  promptCs: string;
  promptEn: string;
  unitCs: string;
  closeAt: Date | null;
  status: "open" | "settled";
  canSettle: boolean; // server-computed: open AND clock expired → reveal time
  entrants: number;
  answerValue: number | null;
  rewardCents: number;
  consolationCents: number;
};

export function AdminGuessPanel({ lang, rounds }: { lang: Lang; rounds: GuessAdminRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [promptCs, setPromptCs] = useState("");
  const [promptEn, setPromptEn] = useState("");
  const [unitCs, setUnitCs] = useState("");
  const [unitEn, setUnitEn] = useState("");
  const [hours, setHours] = useState("24");
  const [reward, setReward] = useState("200");
  const [consolation, setConsolation] = useState("50");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [settling, setSettling] = useState<string | null>(null);

  const create = () => {
    if (pending) return;
    start(async () => {
      const res = await adminFunCreateGuessRound({
        promptCs,
        promptEn,
        unitCs,
        unitEn,
        closeInHours: parseInt(hours, 10) || 24,
        rewardMonos: parseFloat(reward) || 200,
        consolationMonos: parseFloat(consolation) || 50,
      });
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.savedToast);
        setPromptCs(""); setPromptEn("");
        router.refresh();
      }
    });
  };

  const settle = (id: string) => {
    const a = Number(answers[id]);
    if (!Number.isFinite(a)) return;
    setSettling(id);
    start(async () => {
      const res = await guessSettle(id, a);
      setSettling(null);
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(`${t.guessSettledT} · +${fmtMonos(res.paid ?? 0, { lang })}`);
        router.refresh();
      }
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-semibold text-[15px] mb-1 flex items-center gap-2">
          <Target className="size-4 text-brand" /> {t.admGuessNew}
        </h2>
        <p className="text-[12px] text-mute mb-4">{t.admGuessSub}</p>
        <div className="grid gap-3">
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admGuessPromptCs}</label>
            <Input value={promptCs} onChange={(e) => setPromptCs(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admGuessPromptEn}</label>
            <Input value={promptEn} onChange={(e) => setPromptEn(e.target.value)} className="mt-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admGuessUnitCs}</label>
              <Input value={unitCs} onChange={(e) => setUnitCs(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admGuessUnitEn}</label>
              <Input value={unitEn} onChange={(e) => setUnitEn(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admGuessCloseIn}</label>
              <Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} className="mt-1 num" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admGuessReward}</label>
              <Input type="number" value={reward} onChange={(e) => setReward(e.target.value)} className="mt-1 num" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admGuessConsolation}</label>
              <Input type="number" value={consolation} onChange={(e) => setConsolation(e.target.value)} className="mt-1 num" />
            </div>
          </div>
          <div>
            <Button onClick={create} disabled={pending || !promptCs.trim() || !promptEn.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />} {t.admGuessCreateCta}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-[15px] mb-3">{t.admGuessRounds}</h2>
        {rounds.length === 0 ? (
          <p className="text-[13px] text-mute">{t.admGuessRoundEmpty}</p>
        ) : (
          <div className="divide-y divide-line-2 max-h-[520px] overflow-y-auto">
            {rounds.map((r) => {
              const canSettle = r.canSettle;
              return (
                <div key={r.id} className="py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">{r.promptCs}</div>
                      <div className="text-[11.5px] text-faint truncate">{r.promptEn}</div>
                    </div>
                    <Badge tone={r.status === "settled" ? "ink" : canSettle ? "warn" : "yes"}>
                      {r.status === "settled" ? t.guessSettledT : canSettle ? "!" : t.admGuessOpenBadge}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[11.5px] text-faint">
                    {r.answerValue != null
                      ? `${t.guessAnswerWas}: ${r.answerValue}`
                      : closedLabel(r.closeAt)} · {r.entrants}
                  </div>
                  {canSettle && (
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="number"
                        value={answers[r.id] ?? ""}
                        onChange={(e) => setAnswers((a) => ({ ...a, [r.id]: e.target.value }))}
                        placeholder={t.admGuessAnswerPh}
                        className="max-w-32 num"
                      />
                      <Button size="sm" onClick={() => settle(r.id)} disabled={settling === r.id || !answers[r.id]}>
                        {settling === r.id && <Loader2 className="size-3.5 animate-spin" />}
                        {t.admGuessAnswer}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function closedLabel(close: Date | null): string {
  if (!close) return "—";
  return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(close);
}

// ---------- poll rounds (minority wins) ----------
export type PollAdminRow = {
  id: string;
  qCs: string;
  qEn: string;
  aCs: string;
  closeAt: Date;
  status: "open" | "settled";
  winningSide: string | null; // 'a' | 'b' | 'both' | null once settled
  countA: number;
  countB: number;
  rewardCents: number;
  consolationCents: number;
};

// Winner label for the settle stamp, localized.
function pollWinnerLabel(lang: Lang, winningSide: string | null): string {
  const t = getT(lang);
  if (winningSide === "a") return "A";
  if (winningSide === "b") return "B";
  if (winningSide === "both") return t.pollWinners;
  return "—";
}

export function AdminPollPanel({ lang, polls }: { lang: Lang; polls: PollAdminRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qCs, setQCs] = useState("");
  const [qEn, setQEn] = useState("");
  const [aCs, setACs] = useState("");
  const [aEn, setAEn] = useState("");
  const [bCs, setBCs] = useState("");
  const [bEn, setBEn] = useState("");
  const [hours, setHours] = useState("168");
  const [reward, setReward] = useState("100");
  const [consolation, setConsolation] = useState("0");
  const [settling, setSettling] = useState<string | null>(null);

  const create = () => {
    if (pending) return;
    start(async () => {
      const res = await adminFunCreatePoll({
        qCs,
        qEn,
        aCs,
        aEn,
        bCs,
        bEn,
        closeInHours: parseInt(hours, 10) || 168,
        rewardMonos: parseFloat(reward) || 100,
        consolationMonos: parseFloat(consolation) || 0,
      });
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.savedToast);
        setQCs(""); setQEn(""); setACs(""); setAEn(""); setBCs(""); setBEn("");
        router.refresh();
      }
    });
  };

  const settle = (id: string) => {
    setSettling(id);
    start(async () => {
      const res = await pollSettle(id);
      setSettling(null);
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(`${t.pollSettledT} · +${fmtMonos(res.paid ?? 0, { lang })}`);
        router.refresh();
      }
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-semibold text-[15px] mb-1 flex items-center gap-2">
          <Coins className="size-4 text-brand" /> {t.admPollNew}
        </h2>
        <p className="text-[12px] text-mute mb-4">{t.admPollSub}</p>
        <div className="grid gap-3">
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admPollQCs}</label>
            <Input value={qCs} onChange={(e) => setQCs(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admPollQEn}</label>
            <Input value={qEn} onChange={(e) => setQEn(e.target.value)} className="mt-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admPollACs}</label>
              <Input value={aCs} onChange={(e) => setACs(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admPollAEn}</label>
              <Input value={aEn} onChange={(e) => setAEn(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admPollBCs}</label>
              <Input value={bCs} onChange={(e) => setBCs(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admPollBEn}</label>
              <Input value={bEn} onChange={(e) => setBEn(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admPollCloseIn}</label>
              <Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} className="mt-1 num" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admPollReward}</label>
              <Input type="number" value={reward} onChange={(e) => setReward(e.target.value)} className="mt-1 num" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admPollConsolation}</label>
              <Input type="number" value={consolation} onChange={(e) => setConsolation(e.target.value)} className="mt-1 num" />
            </div>
          </div>
          <div>
            <Button onClick={create} disabled={pending || !qCs.trim() || !qEn.trim() || !aCs.trim() || !bCs.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />} {t.admPollCreateCta}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-[15px] mb-3">{t.admPollRounds}</h2>
        {polls.length === 0 ? (
          <p className="text-[13px] text-mute">{t.admPollRoundEmpty}</p>
        ) : (
          <div className="divide-y divide-line-2 max-h-[520px] overflow-y-auto">
            {polls.map((p) => (
              <div key={p.id} className="py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{p.qCs}</div>
                    <div className="text-[11.5px] text-faint truncate">{p.qEn}</div>
                  </div>
                  <Badge tone={p.status === "settled" ? "ink" : "yes"}>
                    {p.status === "settled" ? t.pollSettledT : t.admGuessOpenBadge}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11.5px] text-faint">
                  <span>
                    A {p.countA} : {p.countB} B
                  </span>
                  <span>Ɱ{Math.round(p.rewardCents / 100)}</span>
                  {p.status === "settled" ? (
                    <span className="text-brand font-semibold">{t.admPollSettled(pollWinnerLabel(lang, p.winningSide))}</span>
                  ) : (
                    <span>{closedLabel(p.closeAt)}</span>
                  )}
                </div>
                {p.status === "open" && (
                  <div className="mt-2">
                    <Button size="sm" onClick={() => settle(p.id)} disabled={settling === p.id}>
                      {settling === p.id && <Loader2 className="size-3.5 animate-spin" />}
                      {t.admPollSettle}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- emoji riddles ----------
export type EmojiAdminRow = {
  id: string;
  emoji: string;
  answerCs: string;
  hintCs: string;
  hintAt: Date;
  closeAt: Date;
  status: "open" | "settled";
  winner: string | null; // username of the first solver, if any
  tries: number; // total guesses made
  rewardCents: number;
};

export function AdminEmojiPanel({ lang, rounds }: { lang: Lang; rounds: EmojiAdminRow[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [emoji, setEmoji] = useState("");
  const [answerCs, setAnswerCs] = useState("");
  const [answerEn, setAnswerEn] = useState("");
  const [hintCs, setHintCs] = useState("");
  const [hintEn, setHintEn] = useState("");
  const [hours, setHours] = useState("24");
  const [reward, setReward] = useState("150");
  const [revealing, setRevealing] = useState<string | null>(null);

  const create = () => {
    if (pending) return;
    start(async () => {
      const res = await adminFunCreateEmojiRound({
        emoji,
        answerCs,
        answerEn,
        hintCs,
        hintEn,
        closeInHours: parseInt(hours, 10) || 24,
        rewardMonos: parseFloat(reward) || 150,
      });
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.savedToast);
        setEmoji(""); setAnswerCs(""); setAnswerEn(""); setHintCs(""); setHintEn("");
        router.refresh();
      }
    });
  };

  const reveal = (id: string) => {
    setRevealing(id);
    start(async () => {
      const res = await emojiReveal(id);
      setRevealing(null);
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.pollSettledT);
        router.refresh();
      }
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-semibold text-[15px] mb-1 flex items-center gap-2">
          <Coins className="size-4 text-brand" /> {t.admEmojiNew}
        </h2>
        <p className="text-[12px] text-mute mb-4">{t.admEmojiSub}</p>
        <div className="grid gap-3">
          <div>
            <label className="text-[11.5px] font-semibold text-mute">{t.admEmojiFace}</label>
            <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="mt-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admEmojiAnswerCs}</label>
              <Input value={answerCs} onChange={(e) => setAnswerCs(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admEmojiAnswerEn}</label>
              <Input value={answerEn} onChange={(e) => setAnswerEn(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admEmojiHintCs}</label>
              <Input value={hintCs} onChange={(e) => setHintCs(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admEmojiHintEn}</label>
              <Input value={hintEn} onChange={(e) => setHintEn(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admEmojiCloseIn}</label>
              <Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} className="mt-1 num" />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold text-mute">{t.admEmojiReward}</label>
              <Input type="number" value={reward} onChange={(e) => setReward(e.target.value)} className="mt-1 num" />
            </div>
          </div>
          <div>
            <Button onClick={create} disabled={pending || !emoji.trim() || !answerCs.trim() || !answerEn.trim()}>
              {pending && <Loader2 className="size-4 animate-spin" />} {t.admEmojiCreateCta}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-[15px] mb-3">{t.admEmojiRounds}</h2>
        {rounds.length === 0 ? (
          <p className="text-[13px] text-mute">{t.admEmojiRoundEmpty}</p>
        ) : (
          <div className="divide-y divide-line-2 max-h-[520px] overflow-y-auto">
            {rounds.map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">
                      {r.emoji} — {r.answerCs}
                    </div>
                    <div className="text-[11.5px] text-faint">
                      {t.admEmojiHintAt} {closedLabel(r.hintAt)} · {closedLabel(r.closeAt)} · {r.tries}
                    </div>
                  </div>
                  <Badge tone={r.status === "settled" ? "ink" : "yes"}>
                    {r.status === "settled" ? (r.winner ? `@${r.winner}` : t.pollSettledT) : t.admGuessOpenBadge}
                  </Badge>
                </div>
                {r.status === "open" && (
                  <div className="mt-2">
                    <Button size="sm" onClick={() => reveal(r.id)} disabled={revealing === r.id}>
                      {revealing === r.id && <Loader2 className="size-3.5 animate-spin" />}
                      {t.admEmojiReveal}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
