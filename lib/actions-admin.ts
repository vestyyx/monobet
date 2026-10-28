"use server";

// Phase 2.2 — the admin money engine. Every Mony movement an admin makes
// flows through THIS file and then straight onto the ledger: a required
// human reason, a per-role cap, one transaction, and an audit row. Nobody
// ever updates `user.balance_cents` by hand.
//
// Ops (per roadmap spec):
//   grant    +amount              kind "grant"
//   deduct   -amount              kind "deduct"
//   set      balance → target     kind "adjust" (single difference entry)
//   refund   +amount              kind "refund"
//   transfer user → another user  kind "transfer" (two legs)
//   reverse  counter-entry for an earlier admin row, original stays visible
// plus bulkGrant (preview→confirm→undo) and freeze/unfreeze.
import { randomUUID, randomInt } from "crypto";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { assertRole, rankOf, parseRole, type Role } from "@/lib/admin/rbac";
import { SUPER_ADMIN_EMAIL } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { credit, lockUser, lockMarket, type Tx } from "@/lib/tx-market";
import { marketYesPrice } from "@/lib/queries";
import {
  moneyDeltaWithinCap,
  moneyKindFor,
  moneyIdemKeyOk,
  moneyReasonOk,
  parsePositiveMonos,
  parseTargetMonos,
  reverseDeltaCents,
  setDeltaCents,
  kindIsReversible,
  bulkSummary,
  MONEY_BULK_MAX_TARGETS,
  type MoneyOp,
} from "@/lib/admin-money";
import {
  banDaysOk,
  banReasonOk,
  inviteCodeFromIndexes,
  INVITE_CODE_LEN,
  roleChangeAllowed,
} from "@/lib/admin-users";
import {
  blocklistPatternOk,
  resolutionNoteOk,
  warnHoursOk,
} from "@/lib/moderation";
import {
  jobRatesOk,
} from "@/lib/jobs";

// Phase 5 — audited desks wrap the player-side market/duel ops (their money
// legs are already single-transaction; see the section comment below).
import {
  adminSettleDuel,
  cancelMarket,
  deleteMarket,
  proposeMarket,
  resolveMarket,
  setHouseRules,
  setLeverageConfig,
} from "@/lib/actions";

export type AdjustResult = { ok: boolean; error?: string; deduped?: boolean };
export type BulkResult = { ok: boolean; error?: string; batchId?: string; count?: number; totalCents?: number };
export type SimpleResult = { ok: boolean; error?: string };
export type UndoResult = { ok: boolean; error?: string; count?: number };

function fail(e: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : fallback };
}

/** Was there already a row with this idempotency key? (repeat submit = no-op) */
async function idemExists(tx: Tx, idemKey: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.ledger.id })
    .from(schema.ledger)
    .where(eq(schema.ledger.idemKey, idemKey))
    .limit(1);
  return !!row;
}

/**
 * Single-player money operation. Returns deduped:true when the idempotency
 * key was seen before (the balance was already touched exactly once).
 */
export async function moneyAdjust(input: {
  userId: string;
  op: MoneyOp;
  amountMonos?: number | string; // grant / deduct / refund / transfer
  targetMonos?: number | string; // set
  toUserId?: string; // transfer
  refLedgerId?: string; // reverse
  reason: string;
  allowNegative?: boolean; // admin+ only — lets the balance go below zero
  idemKey?: string;
}): Promise<AdjustResult> {
  try {
    const admin = await assertRole("moderator");
    const role: Role = admin.parsedRole;

    const reason = (input.reason ?? "").trim();
    if (!moneyReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");
    if (input.idemKey !== undefined && input.idemKey !== "" && !moneyIdemKeyOk(input.idemKey))
      throw new Error("Bad idempotency key");
    if (input.allowNegative && rankOf(role) < rankOf("admin"))
      throw new Error("Only admins may allow a negative balance");
    const allowNeg = !!input.allowNegative;

    // Validate + resolve everything that does NOT need the DB first, so a
    // bad request can never half-apply inside the transaction.
    let delta = 0; // resolved cents moved on the primary leg
    let kind: string;
    let memoBase = "";
    let setTargetCents: number | null = null; // "set": parsed target, delta in tx
    let transfer: { toUserId: string; afterMemo: string } | null = null;

    if (input.op === "set") {
      const target = parseTargetMonos(input.targetMonos ?? "");
      if (target === null) throw new Error("Enter the target balance");
      setTargetCents = target;
      kind = moneyKindFor("set");
      memoBase = `Balance set to Ɱ${(target / 100).toLocaleString("en-US")} — ${reason}`;
      // delta against the live balance is computed inside the tx below
    } else if (input.op === "reverse") {
      kind = moneyKindFor("reverse");
      // full memo gets the row id inside the tx; here just seed the reason
      memoBase = `Reversal: ${reason}`;
      // real delta comes from the referenced row inside the tx below
    } else {
      const amt = parsePositiveMonos(input.amountMonos ?? "");
      if (amt === null) throw new Error("Enter an amount");
      if (!moneyDeltaWithinCap(role, amt))
        throw new Error("That is beyond what your role may move in one action");
      kind = moneyKindFor(input.op);
      memoBase = `${reason} (by ${admin.username})`;
      delta = input.op === "deduct" ? -amt : amt;
      if (input.op === "transfer") {
        if (!input.toUserId || input.toUserId === input.userId)
          throw new Error("Pick a recipient (must differ from the source)");
        transfer = { toUserId: input.toUserId, afterMemo: `${reason} (from ${admin.username})` };
      }
    }

    const res = await db.transaction(async (tx) => {
      const cur = await lockUser(tx, input.userId);
      const idemKey = input.idemKey || null;
      if (idemKey && (await idemExists(tx, idemKey))) return { deduped: true as const };

      // "set" needs the live balance → compute the difference entry now
      if (input.op === "set") {
        const target = setTargetCents as number;
        const d = setDeltaCents(cur.balanceCents, target);
        if (d === null) throw new Error("Balance is already at that value");
        delta = d;
        if (!moneyDeltaWithinCap(role, delta))
          throw new Error("That is beyond what your role may move in one action");
      }

      // "reverse" → load the referenced admin-made row and compute the
      // remainder after whatever partial reversals already happened
      if (input.op === "reverse") {
        if (!input.refLedgerId) throw new Error("Missing the ledger row to reverse");
        const [orig] = await tx
          .select()
          .from(schema.ledger)
          .where(eq(schema.ledger.id, input.refLedgerId))
          .limit(1);
        if (!orig) throw new Error("Original ledger row not found");
        if (!kindIsReversible(orig.kind))
          throw new Error("Only admin-made money rows can be reversed");
        const [rev] = await tx
          .select({ s: sql<string>`coalesce(sum(${schema.ledger.amountCents}), 0)` })
          .from(schema.ledger)
          .where(
            and(
              eq(schema.ledger.kind, "reverse"),
              eq(schema.ledger.userId, orig.userId),
              sql`${schema.ledger.memo} like ${`Reversal of row ${orig.id}%`}`
            )
          );
        const d = reverseDeltaCents(orig.amountCents, Number(rev?.s ?? "0"));
        if (d === null) throw new Error("Nothing left to reverse on that row");
        delta = d;
        if (!moneyDeltaWithinCap(role, delta))
          throw new Error("That is beyond what your role may move in one action");
        memoBase = `Reversal of row ${orig.id} — ${reason}`;
      }

      await credit(tx, input.userId, delta, kind, null, memoBase, {
        idemKey: idemKey ?? undefined,
        allowNegative: allowNeg || undefined,
      });
      if (transfer) {
        // the receiving leg — a transfer, not a grant; key suffixed ":to"
        await credit(tx, transfer.toUserId, -delta, "transfer", null, transfer.afterMemo, {
          idemKey: idemKey ? `${idemKey}:to` : undefined,
        });
      }

      await audit(
        tx,
        admin.id,
        admin.username ?? "?",
        `money.${input.op}`,
        "user",
        input.userId,
        reason,
        { op: input.op, balance: cur.balanceCents },
        { delta }
      );
      revalidatePath("/admin/money");
      revalidatePath(`/admin/players/${input.userId}`);
      return { deduped: false as const };
    });

    return { ok: true, deduped: res.deduped || undefined };
  } catch (e) {
    return fail(e, "Money adjustment failed");
  }
}

/** Freeze (or unfreeze) a player — later enforced app-wide by actions.ts. */
export async function freezePlayer(input: {
  userId: string;
  freeze: boolean;
  reason: string;
}): Promise<SimpleResult> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!moneyReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");
    await db.transaction(async (tx) => {
      const cur = await lockUser(tx, input.userId);
      const now = new Date();
      await tx
        .update(schema.user)
        .set({ frozenAt: input.freeze ? now : null })
        .where(eq(schema.user.id, input.userId));
      await audit(
        tx,
        admin.id,
        admin.username ?? "?",
        input.freeze ? "user.freeze" : "user.unfreeze",
        "user",
        input.userId,
        reason,
        { frozenAt: cur.frozenAt ?? null },
        { frozenAt: input.freeze ? now.toISOString() : null }
      );
    });
    revalidatePath("/admin/money");
    revalidatePath(`/admin/players/${input.userId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "Freeze toggle failed");
  }
}

/**
 * Bulk grant — the confirm step of the preview→confirm→undo flow the panel
 * drives. One batch id ties every row together so the undo is a single
 * click later. Scope "all" is admin+ only (a moderator should not be able
 * to touch every account in one move).
 */
export async function bulkGrant(input: {
  scope: "selected" | "squad" | "all";
  userIds?: string[];
  squadId?: string;
  amountMonos: number | string;
  reason: string;
}): Promise<BulkResult> {
  try {
    const admin = await assertRole("moderator");
    const role: Role = admin.parsedRole;
    if (input.scope === "all" && rankOf(role) < rankOf("admin"))
      throw new Error("Only admins may grant to everyone");

    const amt = parsePositiveMonos(input.amountMonos);
    if (amt === null) throw new Error("Enter an amount");
    if (!moneyDeltaWithinCap(role, amt))
      throw new Error("That per-player amount is beyond your role's cap");
    const reason = (input.reason ?? "").trim();
    if (!moneyReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");

    // Resolve the target set
    let ids: string[] = [];
    let scopeLabel: string = input.scope;
    if (input.scope === "selected") {
      ids = (input.userIds ?? []).filter(Boolean);
      if (ids.length === 0) throw new Error("No players selected");
    } else if (input.scope === "squad") {
      if (!input.squadId) throw new Error("No squad selected");
      const rows = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.squadId, input.squadId));
      ids = rows.map((r) => r.id);
      scopeLabel = `squad:${input.squadId}`;
    } else {
      const rows = await db.select({ id: schema.user.id }).from(schema.user);
      ids = rows.map((r) => r.id);
      scopeLabel = "all";
    }
    const summary = bulkSummary(ids.length, amt);
    if (!summary.ok) throw new Error(`Bulk is capped at ${MONEY_BULK_MAX_TARGETS} players`);
    ids = [...new Set(ids)];

    const batchId = randomUUID();
    await db.transaction(async (tx) => {
      for (const uid of ids) {
        await credit(tx, uid, amt, "grant", null, `${reason} (by ${admin.username})`, {
          batchId,
          idemKey: `${batchId}:${uid}`,
        });
      }
      await audit(
        tx,
        admin.id,
        admin.username ?? "?",
        "money.bulkGrant",
        "scope",
        batchId,
        reason,
        { scope: scopeLabel, perPlayerCents: amt },
        { affectedCount: ids.length, totalCents: summary.totalCents }
      );
    });
    revalidatePath("/admin/money");
    return { ok: true, batchId, count: ids.length, totalCents: summary.totalCents };
  } catch (e) {
    return fail(e, "Bulk grant failed");
  }
}

/**
 * Undo a whole bulk batch with counter-entries (kind "reverse"). Idempotent:
 * a second run skips every player whose `${batchId}:undo:` row already
 * exists, so nothing double-applies.
 */
export async function bulkUndo(input: { batchId: string; reason: string }): Promise<UndoResult> {
  try {
    const admin = await assertRole("admin");
    const reason = (input.reason ?? "").trim();
    if (!moneyReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");
    if (!input.batchId) throw new Error("Missing batch id");

    const count = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ userId: schema.ledger.userId, amountCents: schema.ledger.amountCents })
        .from(schema.ledger)
        .where(and(eq(schema.ledger.batchId, input.batchId), eq(schema.ledger.kind, "grant")));

      const undone = await tx
        .select({ idemKey: schema.ledger.idemKey })
        .from(schema.ledger)
        .where(and(eq(schema.ledger.batchId, input.batchId), eq(schema.ledger.kind, "reverse")));
      const undoPrefix = `${input.batchId}:undo:`;
      const undoneUsers = new Set(undone.map((r) => (r.idemKey ?? "").slice(undoPrefix.length)));

      let applied = 0;
      for (const row of rows) {
        if (undoneUsers.has(row.userId)) continue;
        // the counter-entry flips the grant's sign — undoing +Ɱ100 writes −Ɱ100
        await credit(tx, row.userId, -row.amountCents, "reverse", null, `Undo of bulk grant: ${reason}`, {
          batchId: input.batchId,
          idemKey: undoPrefix + row.userId,
        });
        applied++;
      }
      await audit(
        tx,
        admin.id,
        admin.username ?? "?",
        "money.bulkUndo",
        "scope",
        input.batchId,
        reason,
        { batchRows: rows.length },
        { reversedRows: applied }
      );
      return applied;
    });
    revalidatePath("/admin/money");
    return { ok: true, count };
  } catch (e) {
    return fail(e, "Bulk undo failed");
  }
}

// ============================================================
// Phase 3 — players (roles, bans, limits), squads, approvals
// Every action here is audited and role-guarded; the pure rules
// live in lib/admin-users.ts.
// ============================================================

/** Small random sampler for the shared invite alphabet (32 chars). */
function newInviteCode(): string {
  const idx: number[] = [];
  for (let i = 0; i < INVITE_CODE_LEN; i++) idx.push(randomInt(0, 32));
  return inviteCodeFromIndexes(idx);
}

/**
 * Locks a player row and enforces the ladder guard: admins may only act on
 * players strictly below their own rank, and the owner account (super-admin
 * email) is untouchable — just like assertManageableUser in actions.ts, but
 * transactional and returning the locked row.
 */
async function lockManageableTarget(
  tx: Tx,
  admin: { id: string; username: string | null; parsedRole: Role },
  userId: string
) {
  if (userId === admin.id) throw new Error("Can't do this to your own account");
  const [target] = await tx.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1).for("update");
  if (!target) throw new Error("Player not found");
  if ((target.email ?? "").toLowerCase() === SUPER_ADMIN_EMAIL) throw new Error("The owner account can't be modified");
  const targetRole = parseRole(target.role);
  if (targetRole === "owner" || rankOf(targetRole) >= rankOf(admin.parsedRole))
    throw new Error("That player holds an equal or higher rank than you");
  return target;
}

export type Phase3Result = { ok: boolean; error?: string };

// ---------- role changes (rules: admin sets user ↔ moderator, owner handles admins) ----------

export async function adminSetRole(input: { userId: string; role: "user" | "moderator" | "admin" }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");

    await db.transaction(async (tx) => {
      const target = await lockManageableTarget(tx, admin, input.userId);
      const verdict = roleChangeAllowed(admin.parsedRole, parseRole(target.role), input.role);
      if (verdict !== "ok") throw new Error("You can't assign that role to this player");
      await tx.update(schema.user).set({ role: input.role }).where(eq(schema.user.id, input.userId));
      await audit(
        tx,
        admin.id,
        admin.username ?? "?",
        "user.role",
        "user",
        input.userId,
        "Role change",
        { role: target.role },
        { role: input.role }
      );
    });
    revalidatePath("/admin/players");
    revalidatePath(`/admin/players/${input.userId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "Role change failed");
  }
}

// ---------- bans ----------

/** Temp ban with expiry (days). Sessions are dropped so it bites immediately. */
export async function adminTempBan(input: { userId: string; days: number; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");
    if (!banDaysOk(input.days)) throw new Error("Ban length must be 1–365 days");

    const until = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);
    await db.transaction(async (tx) => {
      const target = await lockManageableTarget(tx, admin, input.userId);
      await tx
        .update(schema.user)
        .set({ bannedAt: new Date(), bannedUntil: until, banReason: reason })
        .where(eq(schema.user.id, input.userId));
      await tx.delete(schema.session).where(eq(schema.session.userId, input.userId)); // kick live sessions now
      await audit(
        tx,
        admin.id,
        admin.username ?? "?",
        "user.ban",
        "user",
        input.userId,
        reason,
        { bannedAt: target.bannedAt?.toISOString() ?? null, bannedUntil: target.bannedUntil?.toISOString() ?? null },
        { days: input.days, bannedUntil: until.toISOString() }
      );
    });
    revalidatePath("/admin/players");
    revalidatePath(`/admin/players/${input.userId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "Ban failed");
  }
}

/** Lifts any ban (temp or permanent). Idempotent. */
export async function adminUnban(input: { userId: string; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");

    await db.transaction(async (tx) => {
      const target = await lockManageableTarget(tx, admin, input.userId);
      await tx
        .update(schema.user)
        .set({ bannedAt: null, bannedUntil: null, banReason: null })
        .where(eq(schema.user.id, input.userId));
      await audit(
        tx,
        admin.id,
        admin.username ?? "?",
        "user.unban",
        "user",
        input.userId,
        reason,
        { bannedAt: target.bannedAt?.toISOString() ?? null, bannedUntil: target.bannedUntil?.toISOString() ?? null },
        { bannedUntil: null }
      );
    });
    revalidatePath("/admin/players");
    revalidatePath(`/admin/players/${input.userId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "Unban failed");
  }
}

// ---------- sign-out / player limits ----------

/** Force sign-out everywhere. (Existing sessions are deleted server-side.) */
export async function adminForceLogout(input: { userId: string; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");

    await db.transaction(async (tx) => {
      await lockManageableTarget(tx, admin, input.userId);
      const gone = await tx.delete(schema.session).where(eq(schema.session.userId, input.userId)).returning({ id: schema.session.id });
      await audit(tx, admin.id, admin.username ?? "?", "user.forceLogout", "user", input.userId, reason, null, {
        sessionsKilled: gone.length,
      });
    });
    revalidatePath("/admin/players");
    return { ok: true };
  } catch (e) {
    return fail(e, "Sign-out failed");
  }
}

/** Kid mode toggle — flips the personal stake cap to Ɱ50. */
export async function adminSetKidMode(input: { userId: string; on: boolean; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");

    await db.transaction(async (tx) => {
      const target = await lockManageableTarget(tx, admin, input.userId);
      await tx.update(schema.user).set({ kidMode: input.on }).where(eq(schema.user.id, input.userId));
      await audit(tx, admin.id, admin.username ?? "?", "user.kidMode", "user", input.userId, reason, { kidMode: target.kidMode }, { kidMode: input.on });
    });
    revalidatePath("/admin/players");
    revalidatePath(`/admin/players/${input.userId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "Kid mode failed");
  }
}

/**
 * Personal per-order stake cap in Monys (null = remove the cap; "0" also
 * removes). Kid mode always applies its own Ɱ50 floor on top of this.
 */
export async function adminSetMaxStake(input: {
  userId: string;
  monos: number | string | null;
  reason: string;
}): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");

    let cents: number | null = null;
    if (input.monos !== null && input.monos !== undefined && String(input.monos).trim() !== "") {
      cents = parsePositiveMonos(input.monos);
      if (cents === null) throw new Error("Enter a positive amount");
    }

    await db.transaction(async (tx) => {
      const target = await lockManageableTarget(tx, admin, input.userId);
      await tx.update(schema.user).set({ maxStakeCents: cents }).where(eq(schema.user.id, input.userId));
      await audit(
        tx,
        admin.id,
        admin.username ?? "?",
        "user.maxStake",
        "user",
        input.userId,
        reason,
        { maxStakeCents: target.maxStakeCents ?? null },
        { maxStakeCents: cents }
      );
    });
    revalidatePath("/admin/players");
    revalidatePath(`/admin/players/${input.userId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "Stake cap failed");
  }
}

// ---------- squads ----------

/** Pause/unpause a squad: paused squads refuse joins, invites and sends. */
export async function adminPauseSquad(input: { squadId: string; pause: boolean; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");

    const now = new Date();
    await db.transaction(async (tx) => {
      const [sq] = await tx.select().from(schema.squad).where(eq(schema.squad.id, input.squadId)).limit(1).for("update");
      if (!sq) throw new Error("Squad not found");
      await tx.update(schema.squad).set({ pausedAt: input.pause ? now : null }).where(eq(schema.squad.id, input.squadId));
      await audit(tx, admin.id, admin.username ?? "?", input.pause ? "group.pause" : "group.unpause", "squad", input.squadId, reason, { pausedAt: sq.pausedAt?.toISOString() ?? null }, { pausedAt: input.pause ? now.toISOString() : null });
    });
    revalidatePath("/admin/groups");
    return { ok: true };
  } catch (e) {
    return fail(e, "Squad pause failed");
  }
}

/** Generate a fresh 6-char code (only meaningful while invites are enabled). */
export async function adminRotateInviteCode(input: { squadId: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    let code = "";
    await db.transaction(async (tx) => {
      const [sq] = await tx.select().from(schema.squad).where(eq(schema.squad.id, input.squadId)).limit(1).for("update");
      if (!sq) throw new Error("Squad not found");
      // 5 collision attempts is plenty at family scale (32^6 space)
      for (let attempt = 0; attempt < 5; attempt++) {
        code = newInviteCode();
        const clash = await tx.select({ id: schema.squad.id }).from(schema.squad).where(eq(schema.squad.inviteCode, code)).limit(1);
        if (clash.length === 0) break;
        if (attempt === 4) throw new Error("Code generator busy — try again");
      }
      await tx.update(schema.squad).set({ inviteCode: code, inviteEnabled: true }).where(eq(schema.squad.id, input.squadId));
      await audit(tx, admin.id, admin.username ?? "?", "group.inviteRotate", "squad", input.squadId, "Invite code regenerated", { inviteCode: sq.inviteCode }, { inviteCode: code });
    });
    revalidatePath("/admin/groups");
    return { ok: true };
  } catch (e) {
    return fail(e, "Invite code failed");
  }
}

export async function adminSetInviteEnabled(input: { squadId: string; enabled: boolean; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");

    await db.transaction(async (tx) => {
      const [sq] = await tx.select().from(schema.squad).where(eq(schema.squad.id, input.squadId)).limit(1).for("update");
      if (!sq) throw new Error("Squad not found");
      await tx.update(schema.squad).set({ inviteEnabled: input.enabled }).where(eq(schema.squad.id, input.squadId));
      await audit(tx, admin.id, admin.username ?? "?", "group.inviteToggle", "squad", input.squadId, reason, { inviteEnabled: sq.inviteEnabled }, { inviteEnabled: input.enabled });
    });
    revalidatePath("/admin/groups");
    return { ok: true };
  } catch (e) {
    return fail(e, "Invite toggle failed");
  }
}

/**
 * Group Parent promotion/demotion. Members of a squad have user.squadId set;
 * exactly the flagged ones can kick. Sets one parent per squad (existing
 * parents are demoted).
 */
export async function adminSetSquadParent(input: { squadId: string; userId: string; parent: boolean }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    await db.transaction(async (tx) => {
      const target = await lockManageableTarget(tx, admin, input.userId);
      if (target.squadId !== input.squadId) throw new Error("That player is not in this squad");
      await tx
        .update(schema.user)
        .set({ squadRole: null })
        .where(and(eq(schema.user.squadId, input.squadId), eq(schema.user.squadRole, "parent")));
      await tx.update(schema.user).set({ squadRole: input.parent ? "parent" : null }).where(eq(schema.user.id, input.userId));
      await audit(tx, admin.id, admin.username ?? "?", "group.parent", "squad", input.squadId, input.parent ? `Parent: ${target.username}` : `Parent removed: ${target.username}`, { parent: target.squadRole ?? null }, { parent: input.parent ? target.id : null });
    });
    revalidatePath("/admin/groups");
    return { ok: true };
  } catch (e) {
    return fail(e, "Parent change failed");
  }
}

// ---------- Phase 4 — moderation (reports, comments, blocklist) ----------

/** Take an open report for yourself (assignee = me). */
export async function modAssignReport(input: { reportId: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.report).where(eq(schema.report.id, input.reportId)).limit(1).for("update");
      if (!r) throw new Error("Report not found");
      if (r.status !== "open") throw new Error("Only open reports can be assigned");
      await tx.update(schema.report).set({ assigneeId: admin.id }).where(eq(schema.report.id, input.reportId));
      await audit(tx, admin.id, admin.username ?? "?", "report.assign", "report", input.reportId, `Case taken (${r.kind})`, { assignee: r.assigneeId ?? null }, { assignee: admin.id });
    });
    revalidatePath("/admin/moderation");
    return { ok: true };
  } catch (e) {
    return fail(e, "Assign failed");
  }
}

/** Close the case as handled (action was taken elsewhere: hide/ban/…). */
export async function modResolveReport(input: { reportId: string; note: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const note = (input.note ?? "").trim();
    if (!resolutionNoteOk(note)) throw new Error("Resolution note is required (at least 5 characters)");
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.report).where(eq(schema.report.id, input.reportId)).limit(1).for("update");
      if (!r) throw new Error("Report not found");
      if (r.status !== "open") throw new Error("Only open reports can be resolved");
      await tx
        .update(schema.report)
        .set({ status: "resolved", resolvedAt: new Date(), assigneeId: r.assigneeId ?? admin.id, resolutionNote: note })
        .where(eq(schema.report.id, input.reportId));
      await audit(tx, admin.id, admin.username ?? "?", "report.resolve", "report", input.reportId, note, { status: "open", kind: r.kind }, { status: "resolved" });
    });
    revalidatePath("/admin/moderation");
    return { ok: true };
  } catch (e) {
    return fail(e, "Resolve failed");
  }
}

/** Close the case as not-a-worthy-action (with the reason on record). */
export async function modDismissReport(input: { reportId: string; note: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const note = (input.note ?? "").trim();
    if (!resolutionNoteOk(note)) throw new Error("Dismiss note is required (at least 5 characters)");
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.report).where(eq(schema.report.id, input.reportId)).limit(1).for("update");
      if (!r) throw new Error("Report not found");
      if (r.status !== "open") throw new Error("Only open reports can be dismissed");
      await tx
        .update(schema.report)
        .set({ status: "dismissed", resolvedAt: new Date(), assigneeId: r.assigneeId ?? admin.id, resolutionNote: note })
        .where(eq(schema.report.id, input.reportId));
      await audit(tx, admin.id, admin.username ?? "?", "report.dismiss", "report", input.reportId, note, { status: "open", kind: r.kind }, { status: "dismissed" });
    });
    revalidatePath("/admin/moderation");
    return { ok: true };
  } catch (e) {
    return fail(e, "Dismiss failed");
  }
}

/** Censor/un-censor a comment (body stays stored, UI masks it). */
export async function modHideComment(input: { commentId: string; hidden: boolean; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    let reason = (input.reason ?? "").trim();
    // censor needs the why on record; un-hiding does not. The quick button on
    // the market page censors without an inline note — fall back to a plain one.
    if (input.hidden && !banReasonOk(reason)) reason = "Hidden by a moderator";
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.comment).where(eq(schema.comment.id, input.commentId)).limit(1);
      if (!c) throw new Error("Comment not found");
      if (c.hidden === input.hidden) throw new Error("Already in that state");
      await tx.update(schema.comment).set({ hidden: input.hidden }).where(eq(schema.comment.id, input.commentId));
      const [m] = await tx.select({ slug: schema.market.slug }).from(schema.market).where(eq(schema.market.id, c.marketId)).limit(1);
      if (m) revalidatePath(`/market/${m.slug}`);
      await audit(tx, admin.id, admin.username ?? "?", input.hidden ? "comment.hide" : "comment.unhide", "comment", input.commentId, input.hidden ? reason : "Comment shown again", { hidden: c.hidden }, { hidden: input.hidden });
    });
    revalidatePath("/admin/moderation");
    return { ok: true };
  } catch (e) {
    return fail(e, "Comment hide failed");
  }
}

/** Comment timeout (warn): the author can't post for N hours. */
export async function modWarnPlayer(input: { userId: string; hours: number; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");
    const hours = Math.round(input.hours);
    if (!warnHoursOk(hours)) throw new Error("Hours must be 1–720");
    await db.transaction(async (tx) => {
      const target = await lockManageableTarget(tx, admin, input.userId);
      const until = new Date(Date.now() + hours * 3600_000);
      await tx.update(schema.user).set({ commentBanUntil: until }).where(eq(schema.user.id, input.userId));
      await audit(tx, admin.id, admin.username ?? "?", "comment.timeout", "user", input.userId, reason, { commentBanUntil: target.commentBanUntil }, { commentBanUntil: until, hours });
    });
    revalidatePath("/admin/moderation");
    return { ok: true };
  } catch (e) {
    return fail(e, "Warn failed");
  }
}

/** Permanent comment ban (mute) / lift it. */
export async function modMutePlayer(input: { userId: string; muted: boolean; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (input.muted && !banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");
    await db.transaction(async (tx) => {
      const target = await lockManageableTarget(tx, admin, input.userId);
      if ((target.commentsBanned ?? false) === input.muted) throw new Error("Already in that state");
      await tx.update(schema.user).set({ commentsBanned: input.muted }).where(eq(schema.user.id, input.userId));
      await audit(tx, admin.id, admin.username ?? "?", input.muted ? "user.mute" : "user.unmute", "user", input.userId, input.muted ? reason : "Comments enabled again", { commentsBanned: target.commentsBanned ?? false }, { commentsBanned: input.muted });
    });
    revalidatePath("/admin/moderation");
    return { ok: true };
  } catch (e) {
    return fail(e, "Mute failed");
  }
}

// ---------- blocklist editor (admin+ — it shapes everyone's vocabulary) ----------

/** Add one pattern (loose matching happens at write time in actions.ts). */
export async function modAddBlockPattern(input: { pattern: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("admin");
    const pattern = (input.pattern ?? "").trim();
    if (!blocklistPatternOk(pattern)) throw new Error("Pattern must be 2–40 characters");
    await db.transaction(async (tx) => {
      const [dupe] = await tx.select({ id: schema.blocklist.id }).from(schema.blocklist).where(eq(schema.blocklist.pattern, pattern)).limit(1);
      if (dupe) throw new Error("Already on the list");
      await tx.insert(schema.blocklist).values({ pattern, addedBy: admin.username ?? "?" });
      await audit(tx, admin.id, admin.username ?? "?", "blocklist.add", "blocklist", pattern, pattern, null, { addedBy: admin.username ?? "?" });
    });
    revalidatePath("/admin/moderation");
    return { ok: true };
  } catch (e) {
    return fail(e, "Add failed");
  }
}

export async function modRemoveBlockPattern(input: { id: string; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("admin");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.blocklist).where(eq(schema.blocklist.id, input.id)).limit(1);
      if (!row) throw new Error("Pattern not found");
      await tx.delete(schema.blocklist).where(eq(schema.blocklist.id, input.id));
      await audit(tx, admin.id, admin.username ?? "?", "blocklist.remove", "blocklist", row.pattern, reason, { pattern: row.pattern }, null);
    });
    revalidatePath("/admin/moderation");
    return { ok: true };
  } catch (e) {
    return fail(e, "Remove failed");
  }
}

/** Hand the squad's created-by to another member (admin+; rare rescue op). */
export async function adminTransferSquad(input: { squadId: string; userId: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("admin");
    await db.transaction(async (tx) => {
      const [sq] = await tx.select().from(schema.squad).where(eq(schema.squad.id, input.squadId)).limit(1).for("update");
      if (!sq) throw new Error("Squad not found");
      const target = await lockManageableTarget(tx, admin, input.userId);
      if (target.squadId !== input.squadId) throw new Error("The new owner must be a member of this squad");
      await tx.update(schema.squad).set({ createdBy: input.userId }).where(eq(schema.squad.id, input.squadId));
      await audit(tx, admin.id, admin.username ?? "?", "group.transfer", "squad", input.squadId, `Ownership: ${sq.name}`, { createdBy: sq.createdBy }, { createdBy: input.userId });
    });
    revalidatePath("/admin/groups");
    return { ok: true };
  } catch (e) {
    return fail(e, "Squad transfer failed");
  }
}

// ---------- approvals queue (user-created markets) ----------

/** Approve a pending player-created market straight to tradeable. */
export async function approvalApproveMarket(input: { marketId: string; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");

    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (m.status !== "pending") throw new Error("Not pending");
      await tx.update(schema.market).set({ status: "live" }).where(eq(schema.market.id, input.marketId));
      await tx.insert(schema.pricePoint).values({ marketId: input.marketId, yesPrice: marketYesPrice(m).toFixed(5) });
      await audit(tx, admin.id, admin.username ?? "?", "market.approve", "market", input.marketId, reason, { status: "pending" }, { status: "live" });
    });
    revalidatePath("/admin/approvals");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e, "Approve failed");
  }
}

/** Reject with a required reason (shows on the creator's market card). */
export async function approvalRejectMarket(input: { marketId: string; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("moderator");
    const reason = (input.reason ?? "").trim();
    if (!banReasonOk(reason)) throw new Error("Reason is required (at least 5 characters)");

    await db.transaction(async (tx) => {
      const m = await lockMarket(tx, input.marketId);
      if (m.status !== "pending") throw new Error("Not pending");
      await tx.update(schema.market).set({ status: "rejected" }).where(eq(schema.market.id, input.marketId));
      await audit(tx, admin.id, admin.username ?? "?", "market.reject", "market", input.marketId, reason, { status: "pending" }, { status: "rejected" });
    });
    revalidatePath("/admin/approvals");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e, "Reject failed");
  }
}

// ---------- Phase 5 — markets desk (audited wrappers over the market ops) ----------
//
// The underlying operations (propose/resolve/cancel-refund/delete) already run
// their money leg through one transaction in lib/actions.ts; these wrappers
// add the lord's record: who settled what and why, written right after the
// op succeeds so a refused action never leaves a phantom audit row.

const MARKET_MIN_REASON = 5;

function marketReasonOk(reason: string): boolean {
  return (reason ?? "").trim().length >= MARKET_MIN_REASON && (reason ?? "").trim().length <= 500;
}

/**
 * Create-or-publish a market from the desk (admins publish instantly).
 * Currently unused on purpose: the desk reuses the full MarketForm, which
 * calls proposeMarket directly (admin creation stays unaudited legacy, like
 * CategoriesPanel). Kept here audited and ready for when the desk gets a
 * native creation form.
 */
export async function adminCreateMarket(
  input: Parameters<typeof proposeMarket>[0] & { reason?: string }
): Promise<{ ok: boolean; error?: string; slug?: string }> {
  try {
    const admin = await assertRole("admin");
    const r = await proposeMarket(input);
    if (!r.ok || !r.slug) return r;
    await db.transaction(async (tx) => {
      await audit(tx, admin.id, admin.username ?? "?", "market.create", "market", r.slug!, (input.reason ?? "").trim() || input.question.trim(), null, { slug: r.slug });
    });
    revalidatePath("/admin/markets");
    return r;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed" };
  }
}

/** Settle a live market (binary option or one group option). */
export async function adminResolveMarket(input: { marketId: string; outcome: "yes" | "no"; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("admin");
    if (input.outcome !== "yes" && input.outcome !== "no") throw new Error("Bad outcome");
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);
    const m = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.market).where(eq(schema.market.id, input.marketId)).limit(1);
      return row ?? null;
    });
    if (!m) throw new Error("Market not found");
    const r = await resolveMarket({ marketId: input.marketId, outcome: input.outcome });
    if (!r.ok) return fail(new Error(r.error), "Resolve failed");
    await db.transaction(async (tx) => {
      await audit(tx, admin.id, admin.username ?? "?", "market.resolve", "market", input.marketId, reason, { status: "live" }, { status: "resolved", outcome: input.outcome, paidOut: r.paidOut ?? 0 });
    });
    revalidatePath("/admin/markets");
    return { ok: true };
  } catch (e) {
    return fail(e, "Resolve failed");
  }
}

/** Cancel with position refunds at mark. */
export async function adminCancelMarket(input: { marketId: string; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("admin");
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);
    const r = await cancelMarket(input.marketId);
    if (!r.ok) return fail(new Error(r.error), "Cancel failed");
    await db.transaction(async (tx) => {
      await audit(tx, admin.id, admin.username ?? "?", "market.cancel", "market", input.marketId, reason, { status: "live" }, { status: "cancelled" });
    });
    revalidatePath("/admin/markets");
    return { ok: true };
  } catch (e) {
    return fail(e, "Cancel failed");
  }
}

/** Admin nuke (options included) — open positions refund at mark first. */
export async function adminDeleteMarket(input: { marketId: string; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("admin");
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);
    const r = await deleteMarket(input.marketId);
    if (!r.ok) return fail(new Error(r.error), "Delete failed");
    await db.transaction(async (tx) => {
      await audit(tx, admin.id, admin.username ?? "?", "market.delete", "market", input.marketId, reason, { status: "?" }, { status: "deleted" });
    });
    revalidatePath("/admin/markets");
    return { ok: true };
  } catch (e) {
    return fail(e, "Delete failed");
  }
}

/** Settle a disputed duel — winner takes the pot, or refund both players. */
export async function adminSettleDispute(input: { duelId: string; winnerId: string | null; reason: string }): Promise<Phase3Result> {
  try {
    const admin = await assertRole("admin");
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);
    const r = await adminSettleDuel({ id: input.duelId, winnerId: input.winnerId });
    if (!r.ok) return fail(new Error(r.error), "Settle failed");
    await db.transaction(async (tx) => {
      await audit(tx, admin.id, admin.username ?? "?", "duel.settle", "duel", input.duelId, reason, { status: "disputed" }, { status: "settled", winner: input.winnerId ?? "refund-both" });
    });
    revalidatePath("/admin/moderation");
    return { ok: true };
  } catch (e) {
    return fail(e, "Settle failed");
  }
}

// ---------- Phase 5 — gigs desk (config + shift reversal) ----------

/** Update the singleton gig rates — every payout recalculates with them. */
export async function gigSetConfig(input: {
  dishPayCents: number;
  mathPayCents: number;
  dailyCapCents: number;
  reason: string;
}): Promise<Phase3Result> {
  try {
    const admin = await assertRole("admin");
    const rates = { dishPayCents: Math.round(input.dishPayCents), mathPayCents: Math.round(input.mathPayCents), dailyCapCents: Math.round(input.dailyCapCents) };
    if (!jobRatesOk(rates)) throw new Error("Rates out of bounds (pays 1–50 Ɱ, cap 100–10 000 Ɱ)");
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.gigConfig).limit(1);
      if (!before) {
        await tx.insert(schema.gigConfig).values({ ...rates, updatedBy: admin.username ?? "?" });
      } else {
        await tx.update(schema.gigConfig).set({ ...rates, updatedBy: admin.username ?? "?", updatedAt: new Date() }).where(eq(schema.gigConfig.id, before.id));
      }
      await audit(tx, admin.id, admin.username ?? "?", "gig.config", "gig", "rates", reason, before ?? null, { ...rates, updatedBy: admin.username ?? "?" });
    });
    revalidatePath("/admin/gigs");
    revalidatePath("/jobs");
    return { ok: true };
  } catch (e) {
    return fail(e, "Config failed");
  }
}

/**
 * Claw back a settled shift (bot-speed cheat, overpay, whatever) through the
 * ledger. The shift is stamped `reversed_at` first so it can only happen
 * once; the deduction itself rides the moneyAdjust engine (op "deduct",
 * allowNegative: a spent payout still gets clawed back below zero, admin+).
 * On failure the stamp is lifted so the action can be retried.
 */
export async function gigReverseShift(input: { shiftId: string; reason: string }): Promise<Phase3Result> {
  let adminId = "";
  let adminName = "?";
  try {
    const admin = await assertRole("admin");
    adminId = admin.id;
    adminName = admin.username ?? "?";
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);
    const shift = await db.transaction(async (tx) => {
      const [s] = await tx
        .update(schema.jobShift)
        .set({ reversedAt: new Date() })
        .where(
          and(
            eq(schema.jobShift.id, input.shiftId),
            isNotNull(schema.jobShift.settledAt),
            isNull(schema.jobShift.reversedAt),
            sql`${schema.jobShift.earnedCents} > 0`
          )
        )
        .returning();
      return s ?? null;
    });
    if (!shift) throw new Error("Shift not found or already empty");
    // credit stays for history; a counter-entry zeroes the payout
    const r = await moneyAdjust({
      userId: shift.userId,
      op: "deduct",
      amountMonos: shift.earnedCents / 100,
      reason: `Gig shift reversal (${shift.job}): ${reason}`,
      allowNegative: true,
    });
    if (!r.ok) {
      await db.transaction(async (tx) => {
        await tx.update(schema.jobShift).set({ reversedAt: null }).where(eq(schema.jobShift.id, shift.id));
      });
      return fail(new Error(r.error), "Reverse failed");
    }
    await db.transaction(async (tx) => {
      await audit(tx, adminId, adminName, "gig.reverse", "gig", shift.id, reason, { earned: shift.earnedCents, job: shift.job }, { earned: 0, reversed: true });
    });
    revalidatePath("/admin/gigs");
    return { ok: true };
  } catch (e) {
    return fail(e, "Reverse failed");
  }
}

// ---------- Phase 6 — versioned house config + platform settings ----------
//
// Every audited save of the house knobs reuses the player-facing validation in
// lib/actions.ts (same bounds, same write), then records the values being
// overwritten as a config_version undo point. Rollbacks re-apply an undo point
// through the same save path — history never forks, and each step lands on
// the audit log.

function knobMapFrom(cfg: typeof schema.casinoConfig.$inferSelect | null | undefined): Record<string, number> {
  if (!cfg) return {};
  return {
    tradeMaxLev: cfg.tradeMaxLev,
    levFeeBps: cfg.levFeeBps,
    tradeMaxSpendCents: cfg.tradeMaxSpendCents,
    tradeFeeCents: cfg.tradeFeeCents,
    debtRateBps: cfg.debtRateBps,
    referralRoyaltyBps: cfg.referralRoyaltyBps,
    referralRoyaltyCapCents: cfg.referralRoyaltyCapCents,
    minTradeCents: cfg.minTradeCents,
  };
}

/** Current knob map — captured BEFORE a save so the version is an undo point. */
async function captureKnobs() {
  const [cfg] = await db.select().from(schema.casinoConfig).where(eq(schema.casinoConfig.id, "house")).limit(1);
  return knobMapFrom(cfg);
}

/** Version row = the values as they were before the change (undo point). */
async function writeVersion(adminId: string, adminName: string, note: string, map: Record<string, number>) {
  await db.insert(schema.configVersion).values({
    data: map,
    changedBy: adminId,
    changedByName: adminName,
    note,
  });
}

/** Audited leverage save — same bounds as the player-side action, versioned. */
export async function adminSaveLeverageConfig(input: {
  tradeMaxLev: number;
  levFeeBps: number;
  tradeMaxSpendCents: number;
  reason: string;
}): Promise<Phase3Result> {
  let adminId = "";
  let adminName = "";
  try {
    const admin = await assertRole("admin");
    adminId = admin.id;
    adminName = admin.username ?? "?";
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);
    const before = await captureKnobs();
    const r = await setLeverageConfig({
      tradeMaxLev: input.tradeMaxLev,
      levFeeBps: input.levFeeBps,
      tradeMaxSpendCents: input.tradeMaxSpendCents,
    });
    if (!r.ok) return r;
    await writeVersion(adminId, adminName, `leverage: ${reason}`, before);
    await db.transaction(async (tx) => {
      await audit(
        tx,
        adminId,
        adminName,
        "config.change",
        "config",
        "leverage",
        reason,
        { knobs: "leverage" },
        { tradeMaxLev: input.tradeMaxLev, levFeeBps: input.levFeeBps, tradeMaxSpendCents: input.tradeMaxSpendCents }
      );
    });
    revalidatePath("/admin/economy");
    return { ok: true };
  } catch (e) {
    return fail(e, "Config failed");
  }
}

/** Audited house-rules save — same bounds as the player-side action, versioned. */
export async function adminSaveHouseRules(input: {
  tradeFeeCents: number;
  debtRateBps: number;
  referralRoyaltyBps: number;
  referralRoyaltyCapCents: number;
  minTradeCents: number;
  reason: string;
}): Promise<Phase3Result> {
  let adminId = "";
  let adminName = "";
  try {
    const admin = await assertRole("admin");
    adminId = admin.id;
    adminName = admin.username ?? "?";
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);
    const before = await captureKnobs();
    const r = await setHouseRules({
      tradeFeeCents: input.tradeFeeCents,
      debtRateBps: input.debtRateBps,
      referralRoyaltyBps: input.referralRoyaltyBps,
      referralRoyaltyCapCents: input.referralRoyaltyCapCents,
      minTradeCents: input.minTradeCents,
    });
    if (!r.ok) return r;
    await writeVersion(adminId, adminName, `house_rules: ${reason}`, before);
    await db.transaction(async (tx) => {
      await audit(
        tx,
        adminId,
        adminName,
        "config.change",
        "config",
        "house_rules",
        reason,
        { knobs: "house_rules" },
        {
          tradeFeeCents: input.tradeFeeCents,
          debtRateBps: input.debtRateBps,
          referralRoyaltyBps: input.referralRoyaltyBps,
          referralRoyaltyCapCents: input.referralRoyaltyCapCents,
          minTradeCents: input.minTradeCents,
        }
      );
    });
    revalidatePath("/admin/economy");
    return { ok: true };
  } catch (e) {
    return fail(e, "Config failed");
  }
}

/** Roll a knob set back to a stored snapshot through the same save path. */
export async function adminRollbackConfig(input: { versionId: string; reason: string }): Promise<Phase3Result> {
  let adminId = "";
  let adminName = "";
  try {
    const admin = await assertRole("admin");
    adminId = admin.id;
    adminName = admin.username ?? "?";
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);
    const [v] = await db.select().from(schema.configVersion).where(eq(schema.configVersion.id, input.versionId)).limit(1);
    if (!v) throw new Error("Config version not found");
    const d = (v.data ?? {}) as Record<string, unknown>;
    const num = (k: string, fallback: number) => {
      const n = Number(d[k]);
      return Number.isFinite(n) ? n : fallback;
    };
    // Capture the CURRENT values first — the rollback itself gets an undo
    // point, so an accidental rollback can be rolled back the same way.
    const current = await captureKnobs();
    // A version stores the full knob map, so a rollback restores both halves
    // through the standard save actions (validation + revalidation included).
    const rl = await setLeverageConfig({
      tradeMaxLev: num("tradeMaxLev", 1),
      levFeeBps: num("levFeeBps", 0),
      tradeMaxSpendCents: num("tradeMaxSpendCents", 1000),
    });
    if (!rl.ok) return rl;
    const rr = await setHouseRules({
      tradeFeeCents: num("tradeFeeCents", 0),
      debtRateBps: num("debtRateBps", 0),
      referralRoyaltyBps: num("referralRoyaltyBps", 0),
      referralRoyaltyCapCents: num("referralRoyaltyCapCents", 0),
      minTradeCents: num("minTradeCents", 0),
    });
    if (!rr.ok) return rr;
    await writeVersion(adminId, adminName, `rollback: Rollback to ${v.createdAt.toISOString().slice(0, 16)} (${reason})`, current);
    await db.transaction(async (tx) => {
      await audit(tx, adminId, adminName, "config.rollback", "config", v.id, reason, { note: v.note }, { rolledBack: true });
    });
    revalidatePath("/admin/economy");
    return { ok: true };
  } catch (e) {
    return fail(e, "Rollback failed");
  }
}

/**
 * The /admin/settings write: registration switch, maintenance mode and the
 * global announcement banner. Each section that actually changed gets its own
 * audit row (before→after), all guarded by one reason. Admin-only — these
 * switches shape what guests and every player can do.
 */
export async function adminSetSettings(input: {
  registrationOpen?: boolean;
  maintenance?: boolean;
  annTitle?: string;
  annBody?: string;
  annLevel?: string;
  annUntilDate?: string; // ISO string or "" to clear
  reason: string;
}): Promise<Phase3Result> {
  let adminId = "";
  let adminName = "";
  try {
    const admin = await assertRole("admin");
    adminId = admin.id;
    adminName = admin.username ?? "?";
    const reason = (input.reason ?? "").trim();
    if (!marketReasonOk(reason)) throw new Error(`Reason is required (at least ${MARKET_MIN_REASON} characters)`);

    const [cur] = await db.select().from(schema.platformConfig).limit(1);
    const before = {
      registrationOpen: cur?.registrationOpen ?? true,
      maintenance: cur?.maintenance ?? false,
      annTitle: cur?.annTitle ?? "",
      annBody: cur?.annBody ?? "",
      annLevel: cur?.annLevel ?? "info",
      annUntil: cur?.annUntil ? new Date(cur.annUntil).toISOString() : null,
    };

    const until = input.annUntilDate ? new Date(input.annUntilDate) : null;
    if (until && Number.isNaN(until.getTime())) throw new Error("Bad date");

    const level = input.annLevel === "warn" ? "warn" : "info";
    const after = {
      registrationOpen: typeof input.registrationOpen === "boolean" ? input.registrationOpen : before.registrationOpen,
      maintenance: typeof input.maintenance === "boolean" ? input.maintenance : before.maintenance,
      annTitle: input.annTitle !== undefined ? input.annTitle.trim() : before.annTitle,
      annBody: input.annBody !== undefined ? input.annBody.trim() : before.annBody,
      annLevel: level,
      annUntil: input.annUntilDate !== undefined ? (until ? until.toISOString() : null) : before.annUntil,
    };
    if (after.annTitle.length > 120 || after.annBody.length > 500) throw new Error("Description too long");

    await db
      .insert(schema.platformConfig)
      .values({
        id: "platform",
        ...after,
        annUntil: until,
        updatedBy: adminName,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.platformConfig.id,
        set: { ...after, annUntil: until, updatedBy: adminName, updatedAt: new Date() },
      });

    // One audit row per section that actually changed.
    await db.transaction(async (tx) => {
      if (before.registrationOpen !== after.registrationOpen) {
        await audit(tx, adminId, adminName, "settings.registration", "settings", "platform", reason, before, after);
      }
      if (before.maintenance !== after.maintenance) {
        await audit(tx, adminId, adminName, "settings.maintenance", "settings", "platform", reason, before, after);
      }
      if (
        before.annTitle !== after.annTitle ||
        before.annBody !== after.annBody ||
        before.annLevel !== after.annLevel ||
        before.annUntil !== after.annUntil
      ) {
        await audit(tx, adminId, adminName, "settings.announcement", "settings", "platform", reason, before, after);
      }
    });

    revalidatePath("/admin/settings");
    revalidatePath("/login");
    revalidatePath("/"); // banner
    return { ok: true };
  } catch (e) {
    return fail(e, "Settings failed");
  }
}
