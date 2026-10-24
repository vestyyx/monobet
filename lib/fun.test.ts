import { describe, expect, it } from "vitest";
import {
  funStreakMultiplier,
  triviaRewardCents,
  guessWithinWindow,
  guessDistance,
  guessClampValue,
  pollMinoritySide,
  emojiSolves,
  emojiNormalize,
  emojiAttemptsLeft,
} from "./fun";

describe("funStreakMultiplier", () => {
  it("starts at ×1 for a cold player", () => {
    expect(funStreakMultiplier(0)).toBe(1);
    expect(funStreakMultiplier(-3)).toBe(1);
  });

  it("grows 10% per consecutive correct answer", () => {
    expect(funStreakMultiplier(1)).toBeCloseTo(1.1);
    expect(funStreakMultiplier(5)).toBeCloseTo(1.5);
  });

  it("caps at ×2", () => {
    expect(funStreakMultiplier(10)).toBe(2);
    expect(funStreakMultiplier(50)).toBe(2);
  });
});

describe("triviaRewardCents", () => {
  it("uses the difficulty table", () => {
    expect(triviaRewardCents(0, 1)).toBe(11_000); // Ɱ100 × 1.1 (this answer starts the streak)
    expect(triviaRewardCents(0, 2)).toBe(16_500);
    expect(triviaRewardCents(0, 3)).toBe(22_000);
    expect(triviaRewardCents(0, 99)).toBe(11_000); // unknown difficulty falls back to easy
  });

  it("caps the growth at ×2 of base", () => {
    expect(triviaRewardCents(99, 3)).toBe(40_000);
  });

  it("honors a per-question reward override", () => {
    expect(triviaRewardCents(1, 1, 50_000)).toBe(60_000); // 50k × streak mult 1.2
    expect(triviaRewardCents(1, 1, 0)).toBe(12_000); // 0/undefined → table × streak mult
  });
});

describe("closest guess helpers", () => {
  it("consolation window ±10% of the true answer", () => {
    expect(guessWithinWindow(100, 105)).toBe(true); // diff 5 ≤ 10.5
    expect(guessWithinWindow(115, 100)).toBe(false); // diff 15 > 10
    expect(guessWithinWindow(100, 111)).toBe(true); // diff 11 ≤ 11.1 — window sits on the truth
    expect(guessWithinWindow(0, 0)).toBe(true);
  });

  it("distance is absolute difference", () => {
    expect(guessDistance(30, 100)).toBe(70);
    expect(guessDistance(130, 100)).toBe(30);
  });

  it("clamps absurd guesses", () => {
    expect(guessClampValue(1e12)).toBe(1_000_000_000);
    expect(guessClampValue(12.4)).toBe(12);
    expect(guessClampValue(Number.NaN)).toBe(0);
  });
});

describe("poll minority-wins", () => {
  it("the smaller side takes it in full", () => {
    expect(pollMinoritySide(4, 2)).toBe("b");
    expect(pollMinoritySide(1, 7)).toBe("a");
  });

  it("a tie means both sides win", () => {
    expect(pollMinoritySide(3, 3)).toBe("both");
  });

  it("an empty poll pays nobody", () => {
    expect(pollMinoritySide(0, 0)).toBeNull();
  });
});

describe("emoji answer matching", () => {
  it("normalization ignores case, diacritics and punctuation", () => {
    expect(emojiNormalize("Papancí!!")).toBe("papanci");
    expect(emojiNormalize("  Gr-r-yl, Mami ")).toBe("grrylmami");
    expect(emojiNormalize("ŠUPÁK-Šupák")).toBe("supaksupak");
  });

  it("a guess solves if it matches the CZ or EN answer", () => {
    expect(emojiSolves("PAPANČE s marmeládou", "papanče s marmeládou", "pancakes with jam")).toBe(true);
    expect(emojiSolves("PANCAKES WITH JAM", "papanče s marmeládou", "pancakes with jam")).toBe(true);
    expect(emojiSolves("synové babičky", "dcera babičky", "grandma's daughter")).toBe(false);
    expect(emojiSolves("", "x", "y")).toBe(false); // empty guesses never solve
  });

  it("attempts left never goes negative", () => {
    expect(emojiAttemptsLeft(0)).toBe(3);
    expect(emojiAttemptsLeft(2)).toBe(1);
    expect(emojiAttemptsLeft(3)).toBe(0);
    expect(emojiAttemptsLeft(99)).toBe(0);
  });
});
