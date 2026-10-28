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
  questProofNoteOk,
  photoDataUrlOk,
  parseBracketMatches,
  bracketScore,
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

describe("batch 3 helpers", () => {
  it("quest proof notes are capped, not large essays", () => {
    expect(questProofNoteOk("")).toBe(true); // empty note = no proof needed
    expect(questProofNoteOk("done, took photo")).toBe(true);
    expect(questProofNoteOk(" ".repeat(400))).toBe(true); // trimmed
    expect(questProofNoteOk("x".repeat(401))).toBe(false);
  });

  it("photo data URLs must be images within the size cap", () => {
    expect(photoDataUrlOk("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(photoDataUrlOk("data:image/png;base64,iVBOR")).toBe(true);
    expect(photoDataUrlOk("data:text/html;base64,PGI+")).toBe(false);
    expect(photoDataUrlOk("https://example.com/cat.jpg")).toBe(false);
    expect(photoDataUrlOk("data:image/jpeg;base64," + "A".repeat(400_001))).toBe(false);
  });
});

describe("bracket pools", () => {
  const matches = [
    { label: "QF1 — Sparta vs Slavia", points: 1 },
    { label: "QF2 — Plzeň vs Baník", points: 2 },
    { label: "Final", points: 5 },
  ];

  it("parses 'label | points' lines with a default of 1 point", () => {
    expect(parseBracketMatches("QF1 | 2\nFinal")).toEqual([
      { label: "QF1", points: 2 },
      { label: "Final", points: 1 },
    ]);
  });

  it("ignores empty lines and clamps absurd point values", () => {
    const parsed = parseBracketMatches("  \nA | 0\nB | 1000\n C ");
    expect(parsed).toEqual([
      { label: "A", points: 1 },
      { label: "B", points: 100 },
      { label: "C", points: 1 },
    ]);
  });

  it("caps the match count at the family-scale limit", () => {
    const many = Array.from({ length: 80 }, (_, i) => `M${i}`).join("\n");
    expect(parseBracketMatches(many)).toHaveLength(64);
  });

  it("labels without a numeric tail keep their pipes", () => {
    expect(parseBracketMatches("Winner | of cups")).toEqual([{ label: "Winner | of cups", points: 1 }]);
  });

  it("scores normalized hits with their match points", () => {
    expect(bracketScore({ "0": "Sparta", "1": "plzeň!", "2": "Baník" }, ["sparta", "Plzeň", "BANÍK"], matches)).toBe(8);
  });

  it("missing or empty picks never score", () => {
    expect(bracketScore({}, ["Sparta", "Plzeň", "Baník"], matches)).toBe(0);
    expect(bracketScore({ "0": "", "1": "  ", "2": "?" }, ["Sparta", "Plzeň", "Baník"], matches)).toBe(0);
  });
});
