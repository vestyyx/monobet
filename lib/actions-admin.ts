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
import { and, eq, sql } from "drizzle-orm";
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
