"use server";

// Family-game server actions — Daily Trivia + Closest Guess (batch 1 of the
// friendly corner). Free-play only: no stakes move in, small fixed Mony
// rewards flow out through the standard ledger via credit(). Every mutation
// runs in a locked transaction; double answers/entries die on unique indexes.
import { db, schema } from "@/lib/db";
import { eq, and, isNull, sql, desc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { assertRole } from "@/lib/admin/rbac";
import { credit, lockUser, type Tx } from "@/lib/tx-market";
import { getLang } from "@/lib/lang-server";
import type { Lang } from "@/lib/i18n";
import {
  funToday,
  triviaRewardCents,
  guessClampValue,
  guessDistance,
  guessWithinWindow,
  GUESS_REWARD_CENTS,
  GUESS_CONSOLATION_CENTS,
} from "@/lib/fun";

// ---------- audit (shared by every admin action across the panel) ----------
// The audit log is append-only: no update/delete path will ever exist. Called
// inside the same transaction as the action it describes.
export async function audit(
  tx: Tx,
  adminId: string,
  adminName: string,
  action: string,
  targetType: string,
  targetId: string,
  reason: string,
  before?: unknown,
  after?: unknown
) {
  await tx.insert(schema.adminAudit).values({
    adminId,
    adminName,
    action,
    targetType,
    targetId,
    reason,
    before: (before ?? null) as never,
    after: (after ?? null) as never,
  });
}

// ---------- Daily trivia ----------

// Public view of today's question — `correctIdx` is stripped: it would sit in
// the page payload otherwise, one "view source" away from every kid.
export type TriviaToday = {
  exists: boolean;
  questionId: string | null;
  day: string | null;
  q: string | null;
  options: string[] | null;
  difficulty: number | null;
  answeredChosen: number | null; // null = not answered yet
  answeredCorrect: boolean | null;
  rewardCents: number | null; // what THIS player earned
  answeredCorrectIdx: number | null; // truth revealed only after answering
  pot: number | null; // Ɱ this question pays out at ×1
  streak: number | null; // caller's current consecutive-correct run
  answeredCount: number | null;
  correctCount: number | null;
};

export async function triviaToday(user?: { id: string } | null): Promise<TriviaToday> {
  const day = funToday();
  let [q] = await db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.shownDay, day)).limit(1);

  // Daily pin: the FIRST visitor of the day claims one unshown bank row for
  // today. The conditional UPDATE (…and shown_day is null) makes the claim
  // race-safe — the unique index on shownDay backstops it even further, so a
  // day can never end up with two pinned questions under any concurrency.
  if (!q) {
    for (let tries = 0; tries < 5 && !q; tries++) {
      const claimed = await db.transaction(async (tx) => {
        const [cand] = await tx
          .select({ id: schema.triviaQuestion.id })
          .from(schema.triviaQuestion)
          .where(isNull(schema.triviaQuestion.shownDay))
          .orderBy(schema.triviaQuestion.createdAt)
          .for("update", { skipLocked: true })
          .limit(1);
        if (!cand) return undefined;
        const [row] = await tx
          .update(schema.triviaQuestion)
          .set({ shownDay: day })
          .where(and(eq(schema.triviaQuestion.id, cand.id), isNull(schema.triviaQuestion.shownDay)))
          .returning();
        return row;
      });
      if (claimed) q = claimed;
    }
  }

  if (!q) return { exists: false, questionId: null, day, q: null, options: null, difficulty: null, answeredChosen: null, answeredCorrect: null, rewardCents: null, answeredCorrectIdx: null, pot: null, streak: null, answeredCount: null, correctCount: null };

  let me: typeof schema.triviaAnswer.$inferSelect | null = null;
  let streak: number | null = null;
  if (user) {
    [me] = await db
      .select()
      .from(schema.triviaAnswer)
      .where(and(eq(schema.triviaAnswer.questionId, q.id), eq(schema.triviaAnswer.userId, user.id)))
      .limit(1);
    const [row] = await db.select({ streak: schema.user.triviaStreak }).from(schema.user).where(eq(schema.user.id, user.id)).limit(1);
    streak = row?.streak ?? 0;
  }

  return withTriviaState(q, me, streak);
}

// Shared state assembly once the question row is in hand (used by both the
// passive view and the answer mutation). `me` row, when given, is the caller's
// triviaAnswer.
async function withTriviaState(q: typeof schema.triviaQuestion.$inferSelect, me: typeof schema.triviaAnswer.$inferSelect | null, streak: number | null = null): Promise<TriviaToday> {
  const [stats] = await db
    .select({
      n: sql<number>`count(*)::int`,
      ok: sql<number>`count(*) filter (where ${schema.triviaAnswer.correct})::int`,
    })
    .from(schema.triviaAnswer)
    .where(eq(schema.triviaAnswer.questionId, q.id));

  const cs = q.optionsCs ?? [];
  const en = q.optionsEn ?? [];
  const lang: Lang = await getLang();
  const qText = lang === "cs" ? q.qCs : q.qEn;
  const options = (lang === "cs" ? cs : en).length ? lang === "cs" ? cs : en : cs.length ? cs : en;

  return {
    exists: true,
    questionId: q.id,
    day: q.shownDay,
    q: qText,
    options,
    difficulty: q.difficulty,
    answeredChosen: me?.chosen ?? null,
    answeredCorrect: me?.correct ?? null,
    rewardCents: me?.rewardCents ?? null,
    answeredCorrectIdx: me ? q.correctIdx : null,
    pot: q.rewardCents && q.rewardCents > 0 ? q.rewardCents : null,
    streak,
    answeredCount: stats?.n ?? 0,
    correctCount: stats?.ok ?? 0,
  };
}

// Answer today's question. Race-safe double-answer via the
// (userId, questionId) unique index: the insert throws inside the tx and the
// friendly "already answered" error replaces it.
export async function triviaAnswer(chosenIdx: number): Promise<{ ok: boolean; error?: string; correct?: boolean; correctIdx?: number; rewardCents?: number }> {
  try {
    const u = await requireUser();
    if (u.frozenAt) throw new Error("Account frozen");
    if (!Number.isInteger(chosenIdx) || chosenIdx < 0 || chosenIdx > 7) throw new Error("Pick an answer");

    const day = funToday();
    const [q] = await db.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.shownDay, day)).limit(1);
    if (!q) throw new Error("No question right now");

    let out: { ok: boolean; correct: boolean; correctIdx?: number; rewardCents: number } = { ok: true, correct: false, rewardCents: 0 };
    await db.transaction(async (tx) => {
      // Lock the question row so a settle/withdraw of the same bank row can't
      // interleave; lock the user for the balance + streak update.
      await tx.select().from(schema.triviaQuestion).where(eq(schema.triviaQuestion.id, q.id)).for("update").limit(1);
      await lockUser(tx, u.id);
      const [mine] = await tx
        .select()
        .from(schema.triviaAnswer)
        .where(and(eq(schema.triviaAnswer.questionId, q.id), eq(schema.triviaAnswer.userId, u.id)))
        .limit(1);
      if (mine) throw new Error("ALREADY");

      const correct = chosenIdx === q.correctIdx;
      let rewardCents = 0;
      if (correct) {
        rewardCents = triviaRewardCents(await triviaStreakOf(tx, u.id), q.difficulty, q.rewardCents);
        await tx
          .update(schema.user)
          .set({ triviaStreak: sql`${schema.user.triviaStreak} + 1` })
          .where(eq(schema.user.id, u.id));
      } else {
        await tx.update(schema.user).set({ triviaStreak: 0 }).where(eq(schema.user.id, u.id));
      }
      await tx.insert(schema.triviaAnswer).values({
        userId: u.id,
        questionId: q.id,
        chosen: chosenIdx,
        correct,
        rewardCents,
      });
      if (rewardCents > 0) {
        await credit(tx, u.id, rewardCents, "trivia", null, `Daily trivia — perfect! (streak bonus)`);
      }
      out = { ok: true, correct, correctIdx: q.correctIdx, rewardCents };
    });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong";
    // A concurrent duplicate can't pay twice (unique index) — tell the player
    // their first answer stands.
    if (msg === "ALREADY") return { ok: false, error: "You already answered today" };
    return { ok: false, error: msg };
  }
}

// Read the caller's stored streak INSIDE the tx (rows are locked, so this
// matches what the balance update will write).
async function triviaStreakOf(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx.select({ streak: schema.user.triviaStreak }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  return row?.streak ?? 0;
}

// ---------- Closest guess ----------

export type GuessRoundView = {
  id: string;
  prompt: string;
  unit: string;
  closeAt: Date;
  status: "open" | "settled";
  myValue: number | null;
  entrants: number;
  answerValue: number | null; // settled rounds only — the revealed truth
  winners: { username: string; value: number; rewardCents: number }[]; // settled rounds only
  rewardCents: number;
  consolationCents: number;
};

// Active + recently settled rounds, newest first.
export async function guessList(limit = 12): Promise<GuessRoundView[]> {
  const lang: Lang = await getLang();
  const u = await requireUser();

  const rounds = await db
    .select()
    .from(schema.guessRound)
    .orderBy(desc(schema.guessRound.createdAt))
    .limit(limit);

  const ids = rounds.map((r) => r.id);
  const entries = ids.length
    ? await db
        .select({ roundId: schema.guessEntry.roundId, userId: schema.guessEntry.userId, value: schema.guessEntry.value, rewardCents: schema.guessEntry.rewardCents, username: schema.user.username })
        .from(schema.guessEntry)
        .innerJoin(schema.user, eq(schema.guessEntry.userId, schema.user.id))
        .where(sql`${schema.guessEntry.roundId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
    : [];

  return rounds.map((r) => {
    const mine = entries.find((e) => e.roundId === r.id && e.userId === u.id);
    return {
      id: r.id,
      prompt: lang === "cs" ? r.promptCs : r.promptEn,
      unit: lang === "cs" ? r.unitCs : r.unitEn,
      closeAt: r.closeAt,
      status: (r.status as "open" | "settled") ?? "open",
      myValue: mine ? Number(mine.value) : null,
      entrants: entries.filter((e) => e.roundId === r.id).length,
      answerValue: r.status === "settled" && r.answerValue != null ? Number(r.answerValue) : null,
      rewardCents: r.rewardCents,
      consolationCents: r.consolationCents,
      winners:
        r.status === "settled"
          ? entries
              .filter((e) => e.roundId === r.id && e.rewardCents > 0)
              .map((e) => ({ username: e.username ?? "?", value: Number(e.value), rewardCents: e.rewardCents }))
              .sort((a, b) => b.rewardCents - a.rewardCents)
          : [],
    };
  });
}

// Enter (or re-tune) a guess while a round is open. One entry per player per
// round; re-submitting changes the number rather than erroring.
export async function guessEnter(roundId: string, value: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (u.frozenAt) throw new Error("Account frozen");
    const v = guessClampValue(Number(value));
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.guessRound).where(eq(schema.guessRound.id, roundId)).for("update").limit(1);
      if (!r) throw new Error("Round not found");
      if (r.status !== "open" || r.closeAt.getTime() <= Date.now()) throw new Error("This round is closed");
      const [existing] = await tx
        .select()
        .from(schema.guessEntry)
        .where(and(eq(schema.guessEntry.roundId, r.id), eq(schema.guessEntry.userId, u.id)))
        .for("update")
        .limit(1);
      if (existing) {
        await tx.update(schema.guessEntry).set({ value: v, updatedAt: new Date() }).where(eq(schema.guessEntry.id, existing.id));
      } else {
        await tx.insert(schema.guessEntry).values({ roundId: r.id, userId: u.id, value: v });
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your guess" };
  }
}

// Settle a round: reveal the answer, pay the closest entrant(s) the winner
// reward and everyone inside the ±win% window the consolation. Ties share the
// winner reward (each gets it in full — friendlier and simpler).
export async function guessSettle(roundId: string, answerValue: number): Promise<{ ok: boolean; error?: string; paid?: number }> {
  try {
    const admin = await assertRole("moderator");
    const answer = guessClampValue(Number(answerValue));
    let paid = 0;
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.guessRound).where(eq(schema.guessRound.id, roundId)).for("update").limit(1);
      if (!r) throw new Error("Round not found");
      if (r.status === "settled") throw new Error("Already settled");

      const entries = await tx.select().from(schema.guessEntry).where(eq(schema.guessEntry.roundId, r.id)).for("update");
      // Sort by distance to the truth; Number on bigint mode returns number.
      const ranked = entries
        .map((e) => ({ e, d: guessDistance(Number(e.value), answer) }))
        .sort((a, b) => a.d - b.d);

      const winReward = r.rewardCents > 0 ? r.rewardCents : GUESS_REWARD_CENTS;
      const consReward = r.consolationCents > 0 ? r.consolationCents : GUESS_CONSOLATION_CENTS;
      const winnerDist = ranked[0]?.d ?? null;

      await tx
        .update(schema.guessRound)
        .set({ status: "settled", answerValue: answer, settledBy: admin.id })
        .where(eq(schema.guessRound.id, r.id));

      for (const { e, d } of ranked) {
        const isWinner = winnerDist !== null && d === winnerDist;
        const amt = isWinner ? winReward : guessWithinWindow(Number(e.value), answer) ? consReward : 0;
        if (amt <= 0) continue;
        await lockUser(tx, e.userId);
        await credit(tx, e.userId, amt, "guess", null, isWinner ? `Closest guess — bull's-eye!` : `Closest guess — scorching close`);
        await tx.update(schema.guessEntry).set({ rewardCents: amt }).where(eq(schema.guessEntry.id, e.id));
        paid += amt;
      }

      await audit(tx, admin.id, admin.username ?? admin.email ?? "admin", "game.guessSettle", "guess_round", r.id, `Answer: ${answer}`);
    });
    return { ok: true, paid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Settle failed" };
  }
}

// ---------- admin creators ----------

// Add a question to the trivia bank. Bilingual fields required; validation
// keeps the bank clean so montage pages never render broken options.
export async function adminFunCreateTriviaQuestion(input: {
  qCs: string;
  qEn: string;
  optionsCs: string[];
  optionsEn: string[];
  correctIdx: number;
  difficulty: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await assertRole("moderator");
    const qCs = input.qCs?.trim();
    const qEn = input.qEn?.trim();
    const oCs = (input.optionsCs ?? []).map((s) => s.trim()).filter(Boolean);
    const oEn = (input.optionsEn ?? []).map((s) => s.trim()).filter(Boolean);
    if (!qCs || !qEn) throw new Error("Write the question in both languages");
    if (oCs.length !== oEn.length || oCs.length < 2) throw new Error("Need ≥2 matched options in both languages");
    if (!Number.isInteger(input.correctIdx) || input.correctIdx < 0 || input.correctIdx >= oCs.length) throw new Error("Pick which option is correct");
    const difficulty = [1, 2, 3].includes(input.difficulty) ? input.difficulty : 1;

    await db.transaction(async (tx) => {
      await tx.insert(schema.triviaQuestion).values({
        qCs: qCs!,
        qEn: qEn!,
        optionsCs: oCs,
        optionsEn: oEn,
        correctIdx: input.correctIdx,
        difficulty,
      });
      await audit(tx, admin.id, admin.username ?? "admin", "game.triviaCreate", "trivia_question", "", qCs ?? "");
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add the question" };
  }
}

export async function adminFunCreateGuessRound(input: {
  promptCs: string;
  promptEn: string;
  unitCs: string;
  unitEn: string;
  closeInHours: number;
  rewardMonos: number;
  consolationMonos: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await assertRole("moderator");
    const promptCs = input.promptCs?.trim();
    const promptEn = input.promptEn?.trim();
    if (!promptCs || !promptEn) throw new Error("Write the prompt in both languages");
    const hours = Math.max(1, Math.min(24 * 30, Math.round(Number(input.closeInHours) || 24)));
    const reward = Math.max(0, Math.round((Number(input.rewardMonos) || 200) * 100));
    const cons = Math.max(0, Math.round((Number(input.consolationMonos) || 50) * 100));

    await db.transaction(async (tx) => {
      await tx.insert(schema.guessRound).values({
        promptCs: promptCs!,
        promptEn: promptEn!,
        unitCs: input.unitCs?.trim() ?? "",
        unitEn: input.unitEn?.trim() ?? "",
        closeAt: new Date(Date.now() + hours * 3_600_000),
        rewardCents: reward,
        consolationCents: cons,
        createdBy: admin.id,
      });
      await audit(tx, admin.id, admin.username ?? "admin", "game.guessCreate", "guess_round", "", promptCs ?? "");
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the round" };
  }
}

// Re-export nothing — bottom of file kept clean on purpose.
