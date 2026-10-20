import { describe, expect, it } from "vitest";
import {
  capJobPay,
  DISH_MIN_MS_PER_PLATE,
  DISH_PAY_CENTS,
  DISH_PLATES,
  DISH_SCRUBS,
  dishesPay,
  genMathProblems,
  JOB_DAILY_CAP_CENTS,
  JOB_SHIFT_MAX_MS,
  MATH_MIN_MS_PER_ANSWER,
  MATH_PAY_CENTS,
  MATH_PROBLEMS,
  mathAnswer,
  mathPay,
} from "./jobs";

describe("dishwashing pay", () => {
  it("pays at most the available clean plates", () => {
    expect(dishesPay(DISH_PLATES, DISH_PLATES * DISH_MIN_MS_PER_PLATE)).toBe(DISH_PLATES * DISH_PAY_CENTS);
    expect(dishesPay(12, 11 * DISH_MIN_MS_PER_PLATE)).toBe(11 * DISH_PAY_CENTS);
    expect(dishesPay(4.9, 10_000)).toBe(4 * DISH_PAY_CENTS);
    expect(DISH_SCRUBS).toBe(5);
  });

  it("pays nothing for shifts that are too fast or too long", () => {
    expect(dishesPay(12, 1_499)).toBe(0);
    expect(dishesPay(12, JOB_SHIFT_MAX_MS + 1)).toBe(0);
  });

  it("rejects negative and non-finite inputs", () => {
    expect(dishesPay(-1, 10_000)).toBe(0);
    expect(dishesPay(1, -1)).toBe(0);
    expect(dishesPay(Number.NaN, 10_000)).toBe(0);
    expect(dishesPay(1, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("math tutoring pay", () => {
  it("generates bounded problems for each operation with deterministic randomness", () => {
    const values = [0, 0, 0, 0.5, 0.5, 0.5, 0.999, 0.999, 0.999];
    let index = 0;
    const problems = genMathProblems(() => values[index++ % values.length]);

    expect(problems).toHaveLength(MATH_PROBLEMS);
    expect(problems.slice(0, 3).map((problem) => problem.op)).toEqual(["+", "-", "×"]);
    for (const problem of problems) {
      if (problem.op === "+") {
        expect(problem.a).toBeGreaterThanOrEqual(10);
        expect(problem.a).toBeLessThanOrEqual(99);
        expect(problem.b).toBeGreaterThanOrEqual(10);
        expect(problem.b).toBeLessThanOrEqual(99);
      } else if (problem.op === "-") {
        expect(problem.a).toBeGreaterThanOrEqual(20);
        expect(problem.a).toBeLessThanOrEqual(99);
        expect(problem.b).toBeGreaterThanOrEqual(1);
        expect(problem.b).toBeLessThanOrEqual(problem.a);
        expect(mathAnswer(problem)).toBeGreaterThanOrEqual(0);
      } else {
        expect(problem.a).toBeGreaterThanOrEqual(2);
        expect(problem.a).toBeLessThanOrEqual(12);
        expect(problem.b).toBeGreaterThanOrEqual(2);
        expect(problem.b).toBeLessThanOrEqual(12);
      }
    }
  });

  it("pays for exact answers, limited by elapsed time", () => {
    const problems = genMathProblems(() => 0.5);
    const answers = problems.map(mathAnswer);
    expect(mathPay(problems, answers, MATH_PROBLEMS * MATH_MIN_MS_PER_ANSWER)).toBe(MATH_PROBLEMS * MATH_PAY_CENTS);
    expect(mathPay(problems, answers.slice(0, 4), 10_000)).toBe(4 * MATH_PAY_CENTS);
    expect(mathPay(problems, answers, (MATH_PROBLEMS - 1) * MATH_MIN_MS_PER_ANSWER)).toBe(
      (MATH_PROBLEMS - 1) * MATH_PAY_CENTS
    );
    expect(mathPay(problems, answers, 999)).toBe(0);
  });

  it("rejects overlong, negative, and non-finite shift times", () => {
    const problems = genMathProblems(() => 0.5);
    const answers = problems.map(mathAnswer);
    expect(mathPay(problems, answers, JOB_SHIFT_MAX_MS + 1)).toBe(0);
    expect(mathPay(problems, answers, -1)).toBe(0);
    expect(mathPay(problems, answers, Number.NaN)).toBe(0);
  });
});

describe("daily job earnings cap", () => {
  it("limits earnings to the remaining rolling allowance", () => {
    expect(capJobPay(30_000, 25_000)).toBe(25_000);
    expect(capJobPay(60_000, 49_000)).toBe(1_000);
    expect(capJobPay(10_000, JOB_DAILY_CAP_CENTS)).toBe(0);
    expect(capJobPay(-1, 0)).toBe(0);
    expect(capJobPay(Number.NaN, 0)).toBe(0);
  });
});
