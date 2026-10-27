export const JOBS = ["dishes", "math"] as const;
export type Job = (typeof JOBS)[number];

export const JOB_SHIFT_MAX_MS = 5 * 60_000;
export const JOB_DAILY_CAP_CENTS = 50_000;

export const DISH_PLATES = 12;
export const DISH_SCRUBS = 5;
export const DISH_MIN_MS_PER_PLATE = 1_500;
export const DISH_PAY_CENTS = 300;

export const MATH_PROBLEMS = 10;
export const MATH_MIN_MS_PER_ANSWER = 1_000;
export const MATH_PAY_CENTS = 500;

export type MathProblem = { a: number; b: number; op: "+" | "-" | "×" };

// Phase 5 — admin-tunable rates (persisted in gig_config, singleton row).
// The pay math itself is unchanged; lib/actions only feeds different numbers.
export type JobRates = {
  dishPayCents: number;
  mathPayCents: number;
  dailyCapCents: number;
};

export const DEFAULT_JOB_RATES: JobRates = {
  dishPayCents: DISH_PAY_CENTS,
  mathPayCents: MATH_PAY_CENTS,
  dailyCapCents: JOB_DAILY_CAP_CENTS,
};

/** Sensible bounds so a typo can't hand out Ɱ5,000 a shift. */
export function jobRatesOk(r: JobRates): boolean {
  const ints = [r.dishPayCents, r.mathPayCents, r.dailyCapCents];
  if (ints.some((v) => !Number.isFinite(v) || !Number.isInteger(v))) return false;
  return (
    r.dishPayCents >= 100 &&
    r.dishPayCents <= 5_000 &&
    r.mathPayCents >= 100 &&
    r.mathPayCents <= 5_000 &&
    r.dailyCapCents >= 10_000 &&
    r.dailyCapCents <= 1_000_000
  );
}

function randomInt(min: number, max: number, rand: () => number): number {
  const value = rand();
  if (!Number.isFinite(value)) return min;
  return min + Math.min(max - min, Math.max(0, Math.floor(value * (max - min + 1))));
}

export function dishesPay(plates: number, elapsedMs: number, rates: JobRates = DEFAULT_JOB_RATES): number {
  if (!Number.isFinite(plates) || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > JOB_SHIFT_MAX_MS) {
    return 0;
  }
  const paidPlates = Math.min(
    DISH_PLATES,
    Math.max(0, Math.floor(plates)),
    Math.floor(elapsedMs / DISH_MIN_MS_PER_PLATE)
  );
  return paidPlates * rates.dishPayCents;
}

export function genMathProblems(rand: () => number = Math.random): MathProblem[] {
  return Array.from({ length: MATH_PROBLEMS }, () => {
    const op = (["+","-","×"] as const)[randomInt(0, 2, rand)];
    if (op === "+") return { a: randomInt(10, 99, rand), b: randomInt(10, 99, rand), op };
    if (op === "-") {
      const a = randomInt(20, 99, rand);
      return { a, b: randomInt(1, a, rand), op };
    }
    return { a: randomInt(2, 12, rand), b: randomInt(2, 12, rand), op };
  });
}

export function mathAnswer(problem: MathProblem): number {
  if (problem.op === "+") return problem.a + problem.b;
  if (problem.op === "-") return problem.a - problem.b;
  return problem.a * problem.b;
}

export function mathPay(
  problems: MathProblem[],
  answers: (number | null)[],
  elapsedMs: number,
  rates: JobRates = DEFAULT_JOB_RATES
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > JOB_SHIFT_MAX_MS) return 0;
  const correct = problems.reduce(
    (count, problem, i) => count + (answers[i] === mathAnswer(problem) ? 1 : 0),
    0
  );
  const paidAnswers = Math.min(correct, Math.floor(elapsedMs / MATH_MIN_MS_PER_ANSWER));
  return paidAnswers * rates.mathPayCents;
}

export function capJobPay(
  earnedCents: number,
  earnedLast24hCents: number,
  dailyCapCents: number = JOB_DAILY_CAP_CENTS
): number {
  if (!Number.isFinite(earnedCents) || !Number.isFinite(earnedLast24hCents)) return 0;
  return Math.max(0, Math.min(earnedCents, dailyCapCents - earnedLast24hCents));
}
