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
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { assertRole, rankOf, type Role } from "@/lib/admin/rbac";
import { audit } from "@/lib/audit";
import { credit, lockUser, type Tx } from "@/lib/tx-market";
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
