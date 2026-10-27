import { describe, expect, it } from "vitest";
import {
  roleChangeAllowed,
  banReasonOk,
  banDaysOk,
  personalStakeCapCents,
  KID_MAX_STAKE_CENTS,
  inviteCodeOk,
  inviteCodeFromIndexes,
  squadRoleOk,
} from "./admin-users";

describe("role change ladder", () => {
  it("admins may flip user ↔ moderator, nothing above themselves", () => {
    expect(roleChangeAllowed("admin", "user", "moderator")).toBe("ok");
    expect(roleChangeAllowed("admin", "moderator", "user")).toBe("ok");
    expect(roleChangeAllowed("admin", "user", "user")).toBe("ok");
  });

  it("admins can't manage or create admins/owners", () => {
    expect(roleChangeAllowed("admin", "admin", "user")).toBe("target-too-high");
    expect(roleChangeAllowed("admin", "user", "admin")).toBe("would-create-peer");
    expect(roleChangeAllowed("admin", "owner", "user")).toBe("owner-untouchable");
    expect(roleChangeAllowed("admin", "owner", "admin")).toBe("owner-untouchable");
  });

  it("moderators can't change roles at all (peers rule)", () => {
    expect(roleChangeAllowed("moderator", "user", "moderator")).toBe("would-create-peer");
    expect(roleChangeAllowed("moderator", "user", "user")).toBe("ok"); // harmless reset still allowed
  });

  it("the owner manages admins but not fellow owners (self)", () => {
    expect(roleChangeAllowed("owner", "admin", "user")).toBe("ok");
    expect(roleChangeAllowed("owner", "admin", "moderator")).toBe("ok");
    expect(roleChangeAllowed("owner", "user", "admin")).toBe("ok");
  });

  it("plain users never manage roles", () => {
    expect(roleChangeAllowed("user", "user", "moderator")).toBe("target-too-high");
  });
});

describe("ban rules", () => {
  it("reason must be meaningful", () => {
    expect(banReasonOk("hi")).toBe(false);
    expect(banReasonOk("Spamming the poll chat again")).toBe(true);
    expect(banReasonOk("  ")).toBe(false);
  });

  it("duration is whole days 1..365", () => {
    expect(banDaysOk(7)).toBe(true);
    expect(banDaysOk(365)).toBe(true);
    expect(banDaysOk(0)).toBe(false);
    expect(banDaysOk(-2)).toBe(false);
    expect(banDaysOk(366)).toBe(false);
    expect(banDaysOk(1.5)).toBe(false);
  });
});

describe("personal stake cap", () => {
  it("no personal restriction → market cap wins", () => {
    expect(personalStakeCapCents(false, null, 100_000)).toBe(100_000);
  });

  it("max-stake clamps under the market cap", () => {
    expect(personalStakeCapCents(false, 20_000, 100_000)).toBe(20_000);
    expect(personalStakeCapCents(false, 500_000, 100_000)).toBe(100_000); // personal cap above market = no-op
  });

  it("kid mode hard-caps a single order at Ɱ50", () => {
    expect(personalStakeCapCents(true, null, 100_000)).toBe(KID_MAX_STAKE_CENTS);
    expect(personalStakeCapCents(true, 2_000, 100_000)).toBe(2_000); // explicit max still tighter
    expect(personalStakeCapCents(true, null, 1_000)).toBe(1_000); // market draws the floor
  });
});

describe("invite codes", () => {
  it("6 chars of unambiguous uppercase/digits", () => {
    expect(inviteCodeOk("A7K2PZ")).toBe(true);
    expect(inviteCodeOk("a7k2pz")).toBe(false);
    expect(inviteCodeOk("A7K2P")).toBe(false);
    expect(inviteCodeOk("A7K2PZ0")).toBe(false);
    expect(inviteCodeOk("A7K-PZ")).toBe(false);
    expect(inviteCodeOk("")).toBe(false);
  });

  it("index→code projection stays inside the alphabet and wraps negatives", () => {
    expect(inviteCodeFromIndexes([0, 1, 2, 3, 4, 5])).toBe("ABCDEF");
    const code = inviteCodeFromIndexes([9, 8, 7, 6, 5, 4]);
    expect(code.length).toBe(6);
    for (const ch of code) expect("ABCDEFGHJKLMNPQRSTUVWXYZ23456789").toContain(ch);
    // negative indexes wrap instead of emitting NaN
    expect(inviteCodeFromIndexes([-1, -2, 0, 0, 0, 0]).length).toBe(6);
  });
});

describe("squad rank field", () => {
  it("accepts null/everything but 'parent' as ordinary member", () => {
    expect(squadRoleOk(null)).toBe(true);
    expect(squadRoleOk(undefined)).toBe(true);
    expect(squadRoleOk("member")).toBe(true);
    expect(squadRoleOk("parent")).toBe(true);
  });
});
