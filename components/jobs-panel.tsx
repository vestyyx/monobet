"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Utensils } from "lucide-react";
import { toast } from "sonner";
import { finishJobShift, startJobShift } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";
import {
  DISH_PLATES,
  DISH_SCRUBS,
  JOBS,
  MATH_PROBLEMS,
  type Job,
  type MathProblem,
} from "@/lib/jobs";
import { fmtMonos } from "@/lib/money";
import { Button, Card, Input } from "@/components/ui/primitives";

type Shift = {
  job: Job;
  token: string;
  plates: number;
  scrubs: number;
  problems: MathProblem[];
  answers: (number | null)[];
  index: number;
};
type ShiftResult = {
  job: Job;
  earnedCents: number;
  grossCents: number;
  capped: boolean;
  correct?: number;
};

export function JobsPanel({ lang }: { lang: Lang }) {
  const t = getT(lang);
  const router = useRouter();
  const [shift, setShift] = useState<Shift | null>(null);
  const [result, setResult] = useState<ShiftResult | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async (job: Job) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await startJobShift({ job });
      if (!response.ok || !response.token) {
        toast.error(t.jobsError);
        return;
      }
      setResult(null);
      setAnswer("");
      setShift({
        job,
        token: response.token,
        plates: 0,
        scrubs: 0,
        problems: response.problems ?? [],
        answers: Array<number | null>(MATH_PROBLEMS).fill(null),
        index: 0,
      });
    } catch {
      toast.error(t.jobsError);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (active: Shift, values: { plates?: number; answers?: (number | null)[] } = {}) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await finishJobShift({ token: active.token, ...values });
      if (!response.ok) {
        toast.error(t.jobsError);
        return;
      }
      setShift(null);
      setAnswer("");
      setResult({
        job: active.job,
        earnedCents: response.earnedCents ?? 0,
        grossCents: response.grossCents ?? 0,
        capped: response.capped ?? false,
        correct: response.correct,
      });
      router.refresh();
    } catch {
      toast.error(t.jobsError);
    } finally {
      setBusy(false);
    }
  };

  const scrub = () => {
    if (!shift || shift.job !== "dishes" || busy) return;
    if (shift.scrubs + 1 < DISH_SCRUBS) {
      setShift({ ...shift, scrubs: shift.scrubs + 1 });
      return;
    }
    const plates = shift.plates + 1;
    if (plates >= DISH_PLATES) {
      void finish(shift, { plates });
    } else {
      setShift({ ...shift, plates, scrubs: 0 });
    }
  };

  const submitAnswer = () => {
    if (!shift || shift.job !== "math" || busy) return;
    const parsed = answer.trim() ? Number(answer) : null;
    const answers = shift.answers.slice();
    answers[shift.index] = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    if (shift.index + 1 === shift.problems.length) {
      void finish(shift, { answers });
    } else {
      setShift({ ...shift, answers, index: shift.index + 1 });
      setAnswer("");
    }
  };

  const cards = [
    { job: JOBS[0], title: t.jobsDishesTitle, description: t.jobsDishesSub, Icon: Utensils },
    { job: JOBS[1], title: t.jobsMathTitle, description: t.jobsMathSub, Icon: GraduationCap },
  ] as const;

  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      {cards.map(({ job, title, description, Icon }) => {
        const activeShift = shift?.job === job ? shift : null;
        const active = !!activeShift;
        const finished = result?.job === job;
        return (
          <Card key={job} className="flex min-h-56 flex-col gap-4 p-4">
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                <Icon className="size-5" />
              </div>
              <div>
                <h2 className="font-semibold">{title}</h2>
                <p className="mt-0.5 text-[12.5px] text-mute">{description}</p>
              </div>
            </div>

            {activeShift?.job === "dishes" && (
              <div className="flex flex-col items-center gap-3">
                <p className="num text-sm font-semibold text-mute">{t.jobsPlate(activeShift.plates + 1, DISH_PLATES)}</p>
                <button
                  type="button"
                  onClick={scrub}
                  disabled={busy}
                  aria-label={t.jobsScrub}
                  className="relative grid size-48 touch-manipulation place-items-center overflow-hidden rounded-full border-[10px] border-slate-300 bg-gradient-to-br from-white to-slate-100 shadow-[inset_0_2px_8px_rgba(15,23,42,0.12),0_8px_20px_rgba(15,23,42,0.12)] transition-transform duration-150 active:scale-95 disabled:pointer-events-none"
                >
                  <span
                    className="absolute inset-5 rounded-full bg-amber-950/60 blur-sm transition-opacity duration-300"
                    style={{ opacity: 1 - activeShift.scrubs / DISH_SCRUBS }}
                  />
                  <span
                    className="absolute left-12 top-10 size-5 rounded-full bg-amber-900/50 blur-[2px] transition-opacity duration-300"
                    style={{ opacity: 1 - activeShift.scrubs / DISH_SCRUBS }}
                  />
                  <Utensils className="relative z-10 size-8 text-slate-500" />
                </button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void finish(activeShift, { plates: activeShift.plates })}>
                  {busy ? t.jobsFinishing : t.jobsFinish}
                </Button>
              </div>
            )}

            {activeShift?.job === "math" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm font-semibold text-mute">
                  <span>{t.jobsProgress(activeShift.index + 1, activeShift.problems.length)}</span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void finish(activeShift, { answers: activeShift.answers })}>
                    {busy ? t.jobsFinishing : t.jobsFinish}
                  </Button>
                </div>
                <div className="num rounded-xl bg-surface-2 px-4 py-5 text-center text-2xl font-bold">
                  {activeShift.problems[activeShift.index]?.a} {activeShift.problems[activeShift.index]?.op} {activeShift.problems[activeShift.index]?.b} = ?
                </div>
                <div className="flex gap-2">
                  <Input
                    key={activeShift.index}
                    autoFocus
                    inputMode="numeric"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitAnswer();
                      }
                    }}
                    placeholder={t.jobsAnswer}
                    aria-label={t.jobsAnswer}
                    disabled={busy}
                  />
                  <Button size="lg" disabled={busy} onClick={submitAnswer}>
                    {busy ? t.jobsFinishing : t.jobsNext}
                  </Button>
                </div>
              </div>
            )}

            {finished && result && (
              <div className="mt-auto rounded-lg bg-surface-2 p-3 text-sm">
                {result.job === "math" && (
                  <p className="mb-1 font-semibold">{t.jobsCorrect(result.correct ?? 0, MATH_PROBLEMS)}</p>
                )}
                {result.capped && result.earnedCents === 0 ? (
                  <p className="font-semibold text-mute">{t.jobsCapped}</p>
                ) : (
                  <>
                    <p className="font-semibold text-yes">{t.jobsEarned(fmtMonos(result.earnedCents, { lang }))}</p>
                    {result.capped && <p className="mt-1 text-[12px] text-mute">{t.jobsCapped}</p>}
                  </>
                )}
                <Button className="mt-3 w-full" size="sm" disabled={busy || !!shift} onClick={() => void start(job)}>
                  {busy ? t.jobsStarting : t.jobsAgain}
                </Button>
              </div>
            )}

            {!active && !finished && (
              <Button className="mt-auto w-full" size="lg" disabled={busy || !!shift} onClick={() => void start(job)}>
                {busy ? t.jobsStarting : t.jobsStart}
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}
