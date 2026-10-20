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

function randomInt(min: number, max: number, rand: () => number): number {
  const value = rand();
  if (!Number.isFinite(value)) return min;
  return min + Math.min(max - min, Math.max(0, Math.floor(value * (max - min + 1))));
}

export function dishesPay(plates: number, elapsedMs: number): number {
  if (!Number.isFinite(plates) || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > JOB_SHIFT_MAX_MS) {
    return 0;
  }
  const paidPlates = Math.min(
    DISH_PLATES,
    Math.max(0, Math.floor(plates)),
    Math.floor(elapsedMs / DISH_MIN_MS_PER_PLATE)
  );
  return paidPlates * DISH_PAY_CENTS;
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

export function mathPay(problems: MathProblem[], answers: (number | null)[], elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > JOB_SHIFT_MAX_MS) return 0;
  const correct = problems.reduce(
    (count, problem, i) => count + (answers[i] === mathAnswer(problem) ? 1 : 0),
    0
  );
  const paidAnswers = Math.min(correct, Math.floor(elapsedMs / MATH_MIN_MS_PER_ANSWER));
  return paidAnswers * MATH_PAY_CENTS;
}

export function capJobPay(earnedCents: number, earnedLast24hCents: number): number {
  if (!Number.isFinite(earnedCents) || !Number.isFinite(earnedLast24hCents)) return 0;
  return Math.max(0, Math.min(earnedCents, JOB_DAILY_CAP_CENTS - earnedLast24hCents));
}
