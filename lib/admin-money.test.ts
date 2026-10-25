import { describe, expect, it } from "vitest";
import {
  moneyCapCents,
  moneyDeltaWithinCap,
  parsePositiveMonos,
  parseTargetMonos,
  setDeltaCents,
  reverseDeltaCents,
  moneyKindFor,
  kindIsReversible,
  moneyReasonOk,
  moneyIdemKeyOk,
  bulkSummary,
} from "./admin-money";

describe("money role caps", () => {
  it("moderator < admin < owner(unlimited)", () => {
    expect(moneyCapCents("moderator")).toBe(100_000);
    expect(moneyCapCents("admin")).toBe(1_000_000);
    expect(moneyCapCents("owner")).toBeNull();
    expect(moneyCapCents("user")).toBeNull(); // meaningless — never granted the engine
  });

  it("deltas are checked against the cap, owner always passes", () => {
    expect(moneyDeltaWithinCap("moderator", 100_000)).toBe(true);
    expect(moneyDeltaWithinCap("moderator", 100_001)).toBe(false);
    expect(moneyDeltaWithinCap("admin", -1_000_000)).toBe(true);
    expect(moneyDeltaWithinCap("admin", -1_000_001)).toBe(false);
    expect(moneyDeltaWithinCap("owner", 99_999_999)).toBe(true);
    expect(moneyDeltaWithinCap("user", 1)).toBe(false);
  });
});

describe("amount parsing", () => {
  it("parses clean positive Monys, tolerates comma decimal", () => {
    expect(parsePositiveMonos("120")).toBe(12_000);
    expect(parsePositiveMonos("1,5")).toBe(150);
    expect(parsePositiveMonos(0.5)).toBe(50);
  });

  it("rejects noise, negatives and zero", () => {
    expect(parsePositiveMonos("abc")).toBeNull();
    expect(parsePositiveMonos("-3")).toBeNull();
    expect(parsePositiveMonos("0")).toBeNull();
    expect(parsePositiveMonos("")).toBeNull();
  });

  it("set targets allow zero, reject negatives", () => {
    expect(parseTargetMonos("0")).toBe(0);
    expect(parseTargetMonos("999")).toBe(99_900);
    expect(parseTargetMonos("-5")).toBeNull();
  });
});

describe("set difference entry", () => {
  it("computes the exact delta, refuses no-op", () => {
    expect(setDeltaCents(150_000, 200_00)).toBe(-130_000);
    expect(setDeltaCents(100, 100)).toBeNull();
    expect(setDeltaCents(0, 10)).toBe(10);
  });
});

describe("reversal math", () => {
  it("counter-entry = -original minus what is already reversed", () => {
    expect(reverseDeltaCents(12_000, 0)).toBe(-12_000);
    expect(reverseDeltaCents(12_000, -12_000)).toBeNull(); // already reversed fully
  });

  it("partial reversal leaves the remainder", () => {
    // original +12, someone already reversed −4 (delta −4) → 8 left to undo
    expect(reverseDeltaCents(12_000, 4_000)).toBe(-16_000);
  });
});

describe("kinds", () => {
  it("map ops to ledger kinds", () => {
    expect(moneyKindFor("set")).toBe("adjust");
    expect(moneyKindFor("deduct")).toBe("deduct");
    expect(moneyKindFor("grant")).toBe("grant");
    expect(moneyKindFor("reverse")).toBe("reverse");
    expect(moneyKindFor("transfer")).toBe("transfer");
    expect(moneyKindFor("refund")).toBe("refund");
  });

  it("game/trade rows are not reversible through this engine", () => {
    expect(kindIsReversible("trivia")).toBe(false);
    expect(kindIsReversible("payout")).toBe(false);
    expect(kindIsReversible("grant")).toBe(true);
    expect(kindIsReversible("adjust")).toBe(true);
  });
});

describe("required reason + idempotency keys", () => {
  it("reason must be meaningful", () => {
    expect(moneyReasonOk("hi")).toBe(false);
    expect(moneyReasonOk("Mistake in settling trivia")).toBe(true);
    expect(moneyReasonOk(" ".repeat(50))).toBe(false);
  });

  it("idempotency keys are short slugs", () => {
    expect(moneyIdemKeyOk("bulk:abc:panna")).toBe(true);
    expect(moneyIdemKeyOk("Bulk_01")).toBe(true);
    expect(moneyIdemKeyOk("x y")).toBe(false);
    expect(moneyIdemKeyOk("")).toBe(false);
  });
});

describe("bulk preview", () => {
  it("affects-N-players summary and guard rails", () => {
    expect(bulkSummary(14, 100_00)).toEqual({ count: 14, totalCents: 1_400_00, ok: true });
    expect(bulkSummary(0, 100_00).ok).toBe(false);
    expect(bulkSummary(501, 100_00).ok).toBe(false);
  });
});
