import { describe, expect, it } from "vitest";
import { reconcileEconomy } from "./econ";

const u = (id: string, balanceCents: number, username = id) => ({ id, username, balanceCents });
const l = (userId: string, amountCents: number) => ({ userId, amountCents });

describe("reconcileEconomy", () => {
  it("reports matching books as zero difference and no broken users", () => {
    const users = [u("a", 15_000), u("b", 5_500)];
    const ledger = [l("a", 10_000), l("a", 5_000), l("b", 5_500)];
    const r = reconcileEconomy(ledger, users);
    expect(r.ledgerSumCents).toBe(20_500);
    expect(r.balanceSumCents).toBe(20_500);
    expect(r.diffCents).toBe(0);
    expect(r.broken).toEqual([]);
  });

  it("flags users whose balance drifted off the books, worst first", () => {
    const users = [u("a", 10_000), u("b", 99_000, "whale"), u("c", 1_000)];
    const ledger = [l("a", 10_000), l("b", 90_000), l("c", 1_000)];
    const r = reconcileEconomy(ledger, users);
    expect(r.diffCents).toBe(-9000);
    expect(r.broken).toEqual([{ id: "b", username: "whale", diffCents: -9000 }]);
  });

  it("ignores ledger rows for unknown (deleted) users entirely", () => {
    const users = [u("a", 3_000)];
    const ledger = [l("a", 3_000), l("ghost", 7_000)];
    const r = reconcileEconomy(ledger, users);
    expect(r.ledgerSumCents).toBe(3_000);
    expect(r.balanceSumCents).toBe(3_000);
    expect(r.diffCents).toBe(0);
    expect(r.broken).toEqual([]);
  });

  it("sorts multiple broken users by absolute drift", () => {
    const users = [u("a", 10_000), u("b", 12_000, "bee"), u("c", 0, "cee")];
    const ledger = [l("a", 10_000), l("b", 13_000), l("c", 7_000)];
    const r = reconcileEconomy(ledger, users);
    expect(r.broken.map((x) => x.username)).toEqual(["cee", "bee"]);
  });
});
