import { describe, expect, it } from "vitest";
import {
  blocklistMatch,
  blocklistPatternOk,
  normalizeLoose,
  reportKindOk,
  reportReasonOk,
  resolutionNoteOk,
  warnHoursOk,
  suspicionVerdict,
  flagOutlierGains,
} from "./moderation";

describe("blocklist matcher", () => {
  it("catches plain and disguised hits on one normalized haystack", () => {
    expect(blocklistMatch("tohle je velky zmetek", ["zmetek"])).toBe("zmetek");
    expect(blocklistMatch("ŽmEtEk celý den", ["zmetek"])).toBe("zmetek");
    expect(blocklistMatch("zm€t3k", ["zmetek"])).toBe("zmetek");
  });

  it("harmless text matches nothing", () => {
    expect(blocklistMatch("Kolikváží Juraj Macek", ["zmetek", "podvod"])).toBeNull();
    expect(blocklistMatch("", ["zmetek"])).toBeNull();
  });

  it("empty patterns and symbol-only entries never match", () => {
    expect(blocklistMatch("klobása", ["", "***", ".."])).toBeNull();
  });

  it("the normalizer folds CZ diacritics and leet", () => {
    expect(normalizeLoose("ŠŤĚŘáŽ")).toBe("steraz");
    expect(normalizeLoose("zm3t€k!")).toBe("zmeteki"); // "!" reads as i
  });
});

describe("blocklist entry rules", () => {
  it("accepts words 2–40 chars, rejects symbol noise and absurd lengths", () => {
    expect(blocklistPatternOk("zmetek")).toBe(true);
    expect(blocklistPatternOk("zkouška podvodu")).toBe(true);
    expect(blocklistPatternOk("a")).toBe(false);
    expect(blocklistPatternOk("!!!")).toBe(false);
    expect(blocklistPatternOk("".padEnd(41, "x"))).toBe(false);
  });
});

describe("report rules", () => {
  it("only known kinds are allowed", () => {
    expect(reportKindOk("comment")).toBe(true);
    expect(reportKindOk("market")).toBe(true);
    expect(reportKindOk("spam")).toBe(false);
  });

  it("report reason: one sentence, bounded", () => {
    expect(reportReasonOk("Ci")).toBe(false);
    expect(reportReasonOk("Tento komentář podporuje vy.Identity útok")).toBe(true);
    expect(reportReasonOk("r".repeat(501))).toBe(false);
  });

  it("resolution note: at least 5 chars for both outcomes", () => {
    expect(resolutionNoteOk("Na j")).toBe(false);
    expect(resolutionNoteOk("Banned 3 dny")).toBe(true);
    expect(resolutionNoteOk("    ")).toBe(false);
  });
});

describe("warn hours", () => {
  it("1 hour to 30 days, integers only", () => {
    expect(warnHoursOk(24)).toBe(true);
    expect(warnHoursOk(0)).toBe(false);
    expect(warnHoursOk(24 * 30)).toBe(true);
    expect(warnHoursOk(24 * 30 + 1)).toBe(false);
    expect(warnHoursOk(0.5)).toBe(false);
  });
});

describe("suspicion scoring", () => {
  it("quiet players stay clear", () => {
    expect(suspicionVerdict({ sharedAccounts: 1, actionsLastHour: 2, weeklyGainCents: 1000, medianGainCents: 1000 }).level).toBe("none");
  });

  it("shared devices trade fast earn big stack up", () => {
    const v = suspicionVerdict({
      sharedAccounts: 4,
      actionsLastHour: 45,
      weeklyGainCents: 900_000,
      medianGainCents: 100_000,
    });
    expect(v.level).toBe("high");
    expect(v.score).toBe(8);
  });

  it("two accounts + brisk action is a watch, not a raid", () => {
    expect(suspicionVerdict({ sharedAccounts: 2, actionsLastHour: 15, weeklyGainCents: 0, medianGainCents: 0 }).level).toBe("medium");
    expect(suspicionVerdict({ sharedAccounts: 0, actionsLastHour: 15, weeklyGainCents: 0, medianGainCents: 0 }).level).toBe("none");
  });

  it("earnings counts: one signal alone never raids, two do", () => {
    // single biggest-earner signal stays a "keep an eye" (score 3), because
    // high verdicts need a second independent signal (shared box, velocity…)
    expect(suspicionVerdict({ sharedAccounts: 1, actionsLastHour: 1, weeklyGainCents: 2_600_000, medianGainCents: 100_000 }).level).toBe("medium");
    expect(suspicionVerdict({ sharedAccounts: 1, actionsLastHour: 1, weeklyGainCents: 700_000, medianGainCents: 100_000 }).level).toBe("medium");
    expect(suspicionVerdict({ sharedAccounts: 1, actionsLastHour: 1, weeklyGainCents: 200_000, medianGainCents: 100_000 }).level).toBe("none");
  });
});

describe("outlier gains", () => {
  it("flags 3× median and Ɱ1500+, not the floor itself", () => {
    const totals = [100_000, 120_000, 90_000, 500_000, 110_000, 130_000, 400_000, 100_000];
    const flagged = flagOutlierGains(totals);
    // median ≈ 110 000 → floor = 330 000 → flags 500 000 and 400 000
    expect(flagged).toEqual([3, 6]);
  });

  it("empty and uniform sets flag nobody", () => {
    expect(flagOutlierGains([])).toEqual([]);
    expect(flagOutlierGains([1, 1, 1, 1])).toEqual([]);
  });
});
