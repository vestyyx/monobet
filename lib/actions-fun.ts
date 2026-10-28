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
import { audit } from "@/lib/audit";
import { getLang } from "@/lib/lang-server";
import type { Lang } from "@/lib/i18n";
import {
  funToday,
  triviaRewardCents,
  guessClampValue,
  guessDistance,
  guessWithinWindow,
  pollMinoritySide,
  emojiSolves,
  emojiAttemptsLeft,
  funRoundOpen,
  questProofNoteOk,
  photoDataUrlOk,
  QUEST_REWARD_CENTS,
  PHOTO_REWARD_CENTS,
  GUESS_REWARD_CENTS,
  GUESS_CONSOLATION_CENTS,
  TRIVIA_REWARD_BY_DIFFICULTY,
  POLL_REWARD_CENTS,
  EMOJI_REWARD_CENTS,
  BRACKET_REWARD_CENTS,
  BRACKET_CONSOLATION_CENTS,
  BRACKET_PICK_MAX,
  parseBracketMatches,
  bracketScore,
  type BracketMatch,
} from "@/lib/fun";

// ---------- audit ----------
// The audit writer lives in lib/audit.ts (not "use server" — never a client
// endpoint). Every admin action imports it and logs inside its transaction.

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
    pot:
      q.rewardCents && q.rewardCents > 0
        ? q.rewardCents
        : TRIVIA_REWARD_BY_DIFFICULTY[q.difficulty] ?? TRIVIA_REWARD_BY_DIFFICULTY[1],
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

// ---------- Group polls (minority wins) ----------

export type PollView = {
  id: string;
  q: string;
  a: string;
  b: string;
  closeAt: Date;
  status: "open" | "settled";
  mySide: "a" | "b" | null;
  countA: number;
  countB: number;
  winningSide: "a" | "b" | "both" | null; // settled rounds only
  myRewardCents: number | null;
  rewardCents: number;
  consolationCents: number;
};

// Open + recently settled polls, newest first. Re-voting is allowed while a
// poll is open (switch sides freely — the crowd will outsmart itself).
export async function pollList(limit = 12): Promise<PollView[]> {
  const lang: Lang = await getLang();
  const u = await requireUser();

  const rounds = await db.select().from(schema.pollRound).orderBy(desc(schema.pollRound.createdAt)).limit(limit);
  const ids = rounds.map((r) => r.id);
  const votes = ids.length
    ? await db
        .select({ pollId: schema.pollVote.pollId, userId: schema.pollVote.userId, side: schema.pollVote.side, rewardCents: schema.pollVote.rewardCents })
        .from(schema.pollVote)
        .where(sql`${schema.pollVote.pollId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
    : [];

  return rounds.map((r) => {
    const mine = votes.find((v) => v.pollId === r.id && v.userId === u.id);
    const countA = votes.filter((v) => v.pollId === r.id && v.side === "a").length;
    const countB = votes.filter((v) => v.pollId === r.id && v.side === "b").length;
    return {
      id: r.id,
      q: lang === "cs" ? r.qCs : r.qEn,
      a: lang === "cs" ? r.aCs : r.aEn,
      b: lang === "cs" ? r.bCs : r.bEn,
      closeAt: r.closeAt,
      status: (r.status as "open" | "settled") ?? "open",
      mySide: (mine?.side as "a" | "b" | undefined) ?? null,
      countA,
      countB,
      winningSide: r.status === "settled" ? ((r.winningSide as "a" | "b" | "both" | null) ?? null) : null,
      myRewardCents: mine?.rewardCents ?? null,
      rewardCents: r.rewardCents,
      consolationCents: r.consolationCents,
    };
  });
}

// Vote (or switch sides). One vote per player per poll via the unique index.
export async function pollVoteRound(pollId: string, side: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (u.frozenAt) throw new Error("Account frozen");
    if (side !== "a" && side !== "b") throw new Error("Pick a side");

    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.pollRound).where(eq(schema.pollRound.id, pollId)).for("update").limit(1);
      if (!r) throw new Error("Poll not found");
      if (!funRoundOpen(r.status, r.closeAt)) throw new Error("This poll is closed");

      const [existing] = await tx
        .select()
        .from(schema.pollVote)
        .where(and(eq(schema.pollVote.pollId, r.id), eq(schema.pollVote.userId, u.id)))
        .for("update")
        .limit(1);
      if (existing) {
        if (existing.side === side) return; // same side — nothing to do
        await tx.update(schema.pollVote).set({ side }).where(eq(schema.pollVote.id, existing.id));
      } else {
        await tx.insert(schema.pollVote).values({ pollId: r.id, userId: u.id, side });
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your vote" };
  }
}

// Settle a poll: the minority side wins in full (a tie crowns BOTH sides).
// Majority voters get the consolation token only when the admin enabled one
// (default Ɱ0 — the joke of being in the big crowd is the consolation).
export async function pollSettle(pollId: string): Promise<{ ok: boolean; error?: string; paid?: number }> {
  try {
    const admin = await assertRole("moderator");
    let paid = 0;
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.pollRound).where(eq(schema.pollRound.id, pollId)).for("update").limit(1);
      if (!r) throw new Error("Poll not found");
      if (r.status === "settled") throw new Error("Already settled");

      const votes = await tx.select().from(schema.pollVote).where(eq(schema.pollVote.pollId, r.id)).for("update");
      const countA = votes.filter((v) => v.side === "a").length;
      const countB = votes.filter((v) => v.side === "b").length;
      const winner = pollMinoritySide(countA, countB);

      const winReward = r.rewardCents > 0 ? r.rewardCents : POLL_REWARD_CENTS;
      const consReward = Math.max(0, r.consolationCents);

      await tx.update(schema.pollRound).set({ status: "settled", winningSide: winner, settledBy: admin.id }).where(eq(schema.pollRound.id, r.id));

      for (const v of votes) {
        const onWinningSide = winner === "both" || winner === v.side;
        const amt = onWinningSide ? winReward : consReward;
        if (amt <= 0) continue;
        await lockUser(tx, v.userId);
        await credit(tx, v.userId, amt, "poll", null, onWinningSide ? "Family poll — the clever minority" : "Family poll — standing with the crowd");
        await tx.update(schema.pollVote).set({ rewardCents: amt }).where(eq(schema.pollVote.id, v.id));
        paid += amt;
      }

      await audit(tx, admin.id, admin.username ?? "admin", "game.pollSettle", "poll_round", r.id, `A: ${countA}, B: ${countB} → ${winner ?? "nobody"}`);
    });
    return { ok: true, paid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Settle failed" };
  }
}

// ---------- Word/emoji riddles ----------

export type EmojiView = {
  id: string;
  emoji: string;
  closeAt: Date;
  status: "open" | "settled";
  hint: string | null; // visible once the clock passes hintAt (or after settle)
  hintUnlocked: boolean;
  myAttempts: number;
  attemptsLeft: number;
  myGuesses: string[];
  solved: boolean; // by anyone (round settles on solve)
  solvedByMe: boolean;
  winnerUsername: string | null;
  answer: string | null; // revealed only after settle
  rewardCents: number;
};

export async function emojiList(limit = 12): Promise<EmojiView[]> {
  const lang: Lang = await getLang();
  const u = await requireUser();

  const rounds = await db.select().from(schema.emojiRound).orderBy(desc(schema.emojiRound.createdAt)).limit(limit);

  // Lazy close: expired-but-unclaimed rounds settle silently — the riddle is
  // over, reveal the answer; nobody pays anything. Safe to repeat (status
  // guard + row lock) and keeps the list honest without an admin visit.
  const expired = rounds.filter((r) => r.status === "open" && !funRoundOpen(r.status, r.closeAt));
  for (const r of expired) {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.emojiRound).where(eq(schema.emojiRound.id, r.id)).for("update").limit(1);
      if (!row || row.status !== "open" || funRoundOpen(row.status, row.closeAt)) return;
      await tx.update(schema.emojiRound).set({ status: "settled", revealedBy: "auto" }).where(eq(schema.emojiRound.id, row.id));
      await audit(tx, "auto", "auto", "game.emojiAutoClose", "emoji_round", row.id, "No solver before close");
    });
  }

  const ids = rounds.map((r) => r.id);
  const attempts = ids.length
    ? await db
        .select({ roundId: schema.emojiAttempt.roundId, userId: schema.emojiAttempt.userId, guess: schema.emojiAttempt.guess, correct: schema.emojiAttempt.correct })
        .from(schema.emojiAttempt)
        .where(sql`${schema.emojiAttempt.roundId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
    : [];
  const winnerNames = new Map<string, string>();
  const winners = rounds.filter((r) => r.winnerUserId);
  if (winners.length) {
    const wrows = await db
      .select({ id: schema.user.id, username: schema.user.username })
      .from(schema.user)
      .where(sql`${schema.user.id} in (${sql.join(winners.map((w) => sql`${w.winnerUserId!}`), sql`, `)})`);
    for (const w of wrows) winnerNames.set(w.id, w.username ?? "?");
  }

  return rounds.map((r) => {
    const settled = r.status === "settled";
    const mine = attempts.filter((a) => a.roundId === r.id && a.userId === u.id);
    const hintUnlocked = settled || new Date(r.hintAt).getTime() <= Date.now();
    return {
      id: r.id,
      emoji: r.emoji,
      closeAt: r.closeAt,
      status: (r.status as "open" | "settled") ?? "open",
      hint: hintUnlocked ? (lang === "cs" ? r.hintCs : r.hintEn) || null : null,
      hintUnlocked,
      myAttempts: mine.length,
      attemptsLeft: emojiAttemptsLeft(mine.length),
      myGuesses: mine.map((m) => m.guess),
      solved: settled && r.winnerUserId != null,
      solvedByMe: settled && r.winnerUserId === u.id,
      winnerUsername: r.winnerUserId ? winnerNames.get(r.winnerUserId) ?? null : null,
      answer: settled ? (lang === "cs" ? r.answerCs : r.answerEn) : null,
      rewardCents: r.rewardCents,
    };
  });
}

// One guess. Attempts are capped; a correct guess settles the round on the
// spot and pays the solver — the partial unique index guarantees exactly one
// correct attempt row per round ("first solver wins" under any concurrency).
export async function emojiGuess(roundId: string, guessRaw: string): Promise<{ ok: boolean; error?: string; correct?: boolean; attemptsLeft?: number }> {
  try {
    const u = await requireUser();
    if (u.frozenAt) throw new Error("Account frozen");
    const guess = (guessRaw ?? "").trim().slice(0, 120);
    if (!guess) throw new Error("Type a guess");

    let out: { ok: true; correct: boolean; attemptsLeft: number } = { ok: true, correct: false, attemptsLeft: 0 };
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.emojiRound).where(eq(schema.emojiRound.id, roundId)).for("update").limit(1);
      if (!r) throw new Error("Riddle not found");
      if (!funRoundOpen(r.status, r.closeAt)) throw new Error("This riddle is closed");

      const mine = await tx
        .select()
        .from(schema.emojiAttempt)
        .where(and(eq(schema.emojiAttempt.roundId, r.id), eq(schema.emojiAttempt.userId, u.id)))
        .for("update");
      const left = emojiAttemptsLeft(mine.length);
      if (left <= 0) throw new Error("Out of attempts — wait for the reveal");
      const correct = emojiSolves(guess, r.answerCs, r.answerEn);

      if (correct) {
        // Insert kills itself on the partial unique index if another solver
        // got here first → the friendly "already solved" error below.
        await tx.insert(schema.emojiAttempt).values({ roundId: r.id, userId: u.id, guess, correct });
        await tx
          .update(schema.emojiRound)
          .set({ status: "settled", winnerUserId: u.id, revealedBy: SOLVER_STAMP })
          .where(eq(schema.emojiRound.id, r.id));
        const reward = r.rewardCents > 0 ? r.rewardCents : EMOJI_REWARD_CENTS;
        await credit(tx, u.id, reward, "emoji", null, "Emoji riddle — first solver!");
        out = { ok: true, correct: true, attemptsLeft: emojiAttemptsLeft(mine.length + 1) };
      } else {
        await tx.insert(schema.emojiAttempt).values({ roundId: r.id, userId: u.id, guess, correct: false });
        out = { ok: true, correct: false, attemptsLeft: left - 1 };
      }
    });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not record your guess";
    // Concurrent duplicate solver: the first solver's insert won the index.
    if (msg.includes("emoji_first_solver_idx") || msg.includes("duplicate key")) {
      return { ok: false, error: "Someone was a hair faster — this riddle is solved" };
    }
    return { ok: false, error: msg };
  }
}

// Admin reveal for a riddle nobody solved (or an early close): flips status
// and shows the answer. No money moves.
export async function emojiReveal(roundId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await assertRole("moderator");
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.emojiRound).where(eq(schema.emojiRound.id, roundId)).for("update").limit(1);
      if (!r) throw new Error("Riddle not found");
      if (r.status === "settled") throw new Error("Already settled");
      await tx.update(schema.emojiRound).set({ status: "settled", revealedBy: admin.id }).where(eq(schema.emojiRound.id, r.id));
      await audit(tx, admin.id, admin.username ?? "admin", "game.emojiReveal", "emoji_round", r.id, r.answerCs);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reveal failed" };
  }
}

// The reveal stamp for a riddle solved by the first solver — no admin row.
const SOLVER_STAMP = "solver";

// ---------- batch 2 admin creators ----------

export async function adminFunCreatePoll(input: {
  qCs: string;
  qEn: string;
  aCs: string;
  aEn: string;
  bCs: string;
  bEn: string;
  closeInHours: number;
  rewardMonos: number;
  consolationMonos: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await assertRole("moderator");
    const qCs = input.qCs?.trim();
    const qEn = input.qEn?.trim();
    const aCs = input.aCs?.trim();
    const aEn = input.aEn?.trim();
    const bCs = input.bCs?.trim();
    const bEn = input.bEn?.trim();
    if (!qCs || !qEn) throw new Error("Write the question in both languages");
    if (!aCs || !aEn || !bCs || !bEn) throw new Error("Both options in both languages, please");
    const hours = Math.max(1, Math.min(24 * 30, Math.round(Number(input.closeInHours) || 24 * 7)));
    const reward = Math.max(0, Math.round((Number(input.rewardMonos) || 100) * 100));
    const cons = Math.max(0, Math.round((Number(input.consolationMonos) || 0) * 100));

    await db.transaction(async (tx) => {
      await tx.insert(schema.pollRound).values({
        qCs: qCs!,
        qEn: qEn!,
        aCs: aCs!,
        aEn: aEn!,
        bCs: bCs!,
        bEn: bEn!,
        closeAt: new Date(Date.now() + hours * 3_600_000),
        rewardCents: reward,
        consolationCents: cons,
        createdBy: admin.id,
      });
      await audit(tx, admin.id, admin.username ?? "admin", "game.pollCreate", "poll_round", "", qCs ?? "");
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the poll" };
  }
}

export async function adminFunCreateEmojiRound(input: {
  emoji: string;
  answerCs: string;
  answerEn: string;
  hintCs: string;
  hintEn: string;
  closeInHours: number;
  rewardMonos: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await assertRole("moderator");
    const emoji = input.emoji?.trim();
    const answerCs = input.answerCs?.trim();
    const answerEn = input.answerEn?.trim();
    if (!emoji) throw new Error("Give the riddle its emoji");
    if (!answerCs || !answerEn) throw new Error("Write the answer in both languages");
    const hours = Math.max(1, Math.min(24 * 30, Math.round(Number(input.closeInHours) || 24)));
    // The nudge unlocks at 60% of the round by default.
    const hintAt = new Date(Date.now() + hours * 0.6 * 3_600_000);
    const reward = Math.max(0, Math.round((Number(input.rewardMonos) || 150) * 100));

    await db.transaction(async (tx) => {
      await tx.insert(schema.emojiRound).values({
        emoji: emoji!,
        answerCs: answerCs!,
        answerEn: answerEn!,
        hintCs: input.hintCs?.trim() ?? "",
        hintEn: input.hintEn?.trim() ?? "",
        hintAt,
        closeAt: new Date(Date.now() + hours * 3_600_000),
        rewardCents: reward,
      });
      await audit(tx, admin.id, admin.username ?? "admin", "game.emojiCreate", "emoji_round", "", emoji ?? "");
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the riddle" };
  }
}

// ---------- Family quests ----------

export type QuestView = {
  id: string;
  title: string;
  desc: string;
  rewardCents: number;
  proofKind: "none" | "text" | "photo";
  proofAsk: string | null;
  // my claim, if any (one per quest per player — rejected can be re-submitted)
  claimStatus: "pending" | "approved" | "rejected" | null;
  myNote: string | null;
  myPhotoData: string | null; // the player's own proof photo
  myRewardCents: number;
};

// Active quests with the caller's claim state. Approvals/rejections are made
// in the admin panel; a rejection leaves the claim reusable for re-submission.
export async function questList(limit = 20): Promise<QuestView[]> {
  const lang: Lang = await getLang();
  const u = await requireUser();

  const quests = await db
    .select()
    .from(schema.quest)
    .where(eq(schema.quest.active, true))
    .orderBy(desc(schema.quest.createdAt))
    .limit(limit);
  const ids = quests.map((q) => q.id);
  const claims = ids.length
    ? await db
        .select()
        .from(schema.questClaim)
        .where(and(eq(schema.questClaim.userId, u.id), sql`${schema.questClaim.questId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`))
    : [];

  return quests.map((q) => {
    const mine = claims.find((c) => c.questId === q.id);
    return {
      id: q.id,
      title: lang === "cs" ? q.titleCs : q.titleEn,
      desc: lang === "cs" ? q.descCs : q.descEn,
      rewardCents: q.rewardCents,
      proofKind: (q.proofKind as "none" | "text" | "photo") ?? "none",
      proofAsk: (lang === "cs" ? q.proofAskCs : q.proofAskEn) || null,
      claimStatus: (mine?.status as "pending" | "approved" | "rejected" | undefined) ?? null,
      myNote: mine?.note ?? null,
      myPhotoData: mine?.photoData ?? null,
      myRewardCents: mine?.rewardCents ?? 0,
    };
  });
}

// Claim a quest (or re-submit after a rejection). One claim per quest per
// player via the unique index; claiming is free of charge, approval pays.
export async function questClaimStart(
  questId: string,
  noteRaw: string,
  photoData?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (u.frozenAt) throw new Error("Account frozen");
    const note = (noteRaw ?? "").trim().slice(0, 400);
    if (!questProofNoteOk(note)) throw new Error("Note is too long");
    const photo = photoData && photoDataUrlOk(photoData) ? photoData : photoData ? null : undefined;
    if (photo === null) throw new Error("The photo is too large or not an image");

    await db.transaction(async (tx) => {
      const [q] = await tx.select().from(schema.quest).where(eq(schema.quest.id, questId)).for("update").limit(1);
      if (!q || !q.active) throw new Error("Quest not found");
      if (q.proofKind === "photo" && !photo) throw new Error("This quest needs a photo");
      if (q.proofKind === "text" && !note) throw new Error("Write the proof answer");

      const [existing] = await tx
        .select()
        .from(schema.questClaim)
        .where(and(eq(schema.questClaim.questId, q.id), eq(schema.questClaim.userId, u.id)))
        .for("update")
        .limit(1);
      if (existing) {
        if (existing.status === "pending") throw new Error("Already waiting for review");
        if (existing.status === "approved") return; // done is done
        // rejected → re-submit: reset with fresh proof
        await tx
          .update(schema.questClaim)
          .set({ status: "pending", note, photoData: photo ?? existing.photoData, reviewedBy: null, reviewedAt: null })
          .where(eq(schema.questClaim.id, existing.id));
      } else {
        await tx.insert(schema.questClaim).values({ questId: q.id, userId: u.id, note, photoData: photo ?? null });
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not claim the quest" };
  }
}

export type QuestClaimAdminRow = {
  id: string;
  questId: string;
  questTitleCs: string;
  username: string;
  status: "pending" | "approved" | "rejected";
  note: string;
  photoData: string | null;
  rewardCents: number;
  createdAt: Date;
};

export async function questClaimsForAdmin(limit = 60): Promise<QuestClaimAdminRow[]> {
  await assertRole("moderator");
  const rows = await db
    .select({
      id: schema.questClaim.id,
      questId: schema.questClaim.questId,
      questTitleCs: schema.quest.titleCs,
      username: schema.user.username,
      status: schema.questClaim.status,
      note: schema.questClaim.note,
      photoData: schema.questClaim.photoData,
      rewardCents: schema.questClaim.rewardCents,
      createdAt: schema.questClaim.createdAt,
    })
    .from(schema.questClaim)
    .innerJoin(schema.quest, eq(schema.quest.id, schema.questClaim.questId))
    .innerJoin(schema.user, eq(schema.user.id, schema.questClaim.userId))
    .orderBy(desc(schema.questClaim.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, username: r.username ?? "?", status: (r.status as "pending" | "approved" | "rejected") ?? "pending" }));
}

// Review a claim: approval pays the quest reward through the ledger; a
// rejection re-opens the claim for the player to fix. Audited either way.
export async function questReview(claimId: string, approve: boolean): Promise<{ ok: boolean; error?: string; paid?: number }> {
  try {
    const admin = await assertRole("moderator");
    let paid = 0;
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.questClaim).where(eq(schema.questClaim.id, claimId)).for("update").limit(1);
      if (!c) throw new Error("Claim not found");
      if (c.status !== "pending") throw new Error("Already reviewed");
      const [q] = await tx.select().from(schema.quest).where(eq(schema.quest.id, c.questId)).for("update").limit(1);
      if (!q) throw new Error("Quest not found");

      if (approve) {
        const reward = q.rewardCents > 0 ? q.rewardCents : QUEST_REWARD_CENTS;
        await tx
          .update(schema.questClaim)
          .set({ status: "approved", rewardCents: reward, reviewedBy: admin.id, reviewedAt: new Date() })
          .where(eq(schema.questClaim.id, c.id));
        await lockUser(tx, c.userId);
        await credit(tx, c.userId, reward, "quest", null, `Family quest completed — ${q.titleCs}`);
        paid = reward;
      } else {
        await tx
          .update(schema.questClaim)
          .set({ status: "rejected", reviewedBy: admin.id, reviewedAt: new Date() })
          .where(eq(schema.questClaim.id, c.id));
      }

      await audit(tx, admin.id, admin.username ?? "admin", "game.questReview", "quest_claim", c.id, approve ? "approved" : "rejected");
    });
    return { ok: true, paid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Review failed" };
  }
}

export async function adminFunCreateQuest(input: {
  titleCs: string;
  titleEn: string;
  descCs: string;
  descEn: string;
  proofKind: string;
  proofAskCs: string;
  proofAskEn: string;
  rewardMonos: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await assertRole("moderator");
    const titleCs = input.titleCs?.trim();
    const titleEn = input.titleEn?.trim();
    if (!titleCs || !titleEn) throw new Error("Write the title in both languages");
    const proofKind = input.proofKind === "photo" ? "photo" : input.proofKind === "text" ? "text" : "none";
    if (proofKind !== "none" && !input.proofAskCs?.trim()) throw new Error("Say what the proof should be");
    const reward = Math.max(0, Math.round((Number(input.rewardMonos) || 100) * 100));

    await db.transaction(async (tx) => {
      await tx.insert(schema.quest).values({
        titleCs,
        titleEn,
        descCs: input.descCs?.trim() ?? "",
        descEn: input.descEn?.trim() ?? "",
        rewardCents: reward,
        proofKind,
        proofAskCs: input.proofAskCs?.trim() ?? "",
        proofAskEn: input.proofAskEn?.trim() ?? "",
        createdBy: admin.id,
      });
      await audit(tx, admin.id, admin.username ?? "admin", "game.questCreate", "quest", "", titleCs ?? "");
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the quest" };
  }
}

// ---------- Photo guess (macro-shot races) ----------

export type PhotoView = {
  id: string;
  imageData: string;
  q: string;
  closeAt: Date;
  status: "open" | "settled";
  hint: string | null;
  hintUnlocked: boolean;
  myAttempts: number;
  attemptsLeft: number;
  myGuesses: string[];
  solved: boolean;
  solvedByMe: boolean;
  winnerUsername: string | null;
  answer: string | null; // settled rounds only
  rewardCents: number;
};

export async function photoList(limit = 12): Promise<PhotoView[]> {
  const lang: Lang = await getLang();
  const u = await requireUser();

  const rounds = await db.select().from(schema.photoRound).orderBy(desc(schema.photoRound.createdAt)).limit(limit);

  // Lazy close for expired unsolved rounds — reveal the answer, nobody pays.
  const expired = rounds.filter((r) => r.status === "open" && !funRoundOpen(r.status, r.closeAt));
  for (const r of expired) {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.photoRound).where(eq(schema.photoRound.id, r.id)).for("update").limit(1);
      if (!row || row.status !== "open" || funRoundOpen(row.status, row.closeAt)) return;
      await tx.update(schema.photoRound).set({ status: "settled", revealedBy: "auto" }).where(eq(schema.photoRound.id, row.id));
      await audit(tx, "auto", "auto", "game.photoAutoClose", "photo_round", row.id, "No solver before close");
    });
  }

  const ids = rounds.map((r) => r.id);
  const attempts = ids.length
    ? await db
        .select({ roundId: schema.photoAttempt.roundId, userId: schema.photoAttempt.userId, guess: schema.photoAttempt.guess, correct: schema.photoAttempt.correct })
        .from(schema.photoAttempt)
        .where(sql`${schema.photoAttempt.roundId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
    : [];
  const winnerNames = new Map<string, string>();
  const winners = rounds.filter((r) => r.winnerUserId);
  if (winners.length) {
    const wrows = await db
      .select({ id: schema.user.id, username: schema.user.username })
      .from(schema.user)
      .where(sql`${schema.user.id} in (${sql.join(winners.map((w) => sql`${w.winnerUserId!}`), sql`, `)})`);
    for (const w of wrows) winnerNames.set(w.id, w.username ?? "?");
  }

  return rounds.map((r) => {
    const settled = r.status === "settled";
    const mine = attempts.filter((a) => a.roundId === r.id && a.userId === u.id);
    const hintUnlocked = settled || new Date(r.hintAt).getTime() <= Date.now();
    return {
      id: r.id,
      imageData: r.imageData,
      q: lang === "cs" ? r.qCs : r.qEn,
      closeAt: r.closeAt,
      status: (r.status as "open" | "settled") ?? "open",
      hint: hintUnlocked ? (lang === "cs" ? r.hintCs : r.hintEn) || null : null,
      hintUnlocked,
      myAttempts: mine.length,
      attemptsLeft: emojiAttemptsLeft(mine.length),
      myGuesses: mine.map((m) => m.guess),
      solved: settled && r.winnerUserId != null,
      solvedByMe: settled && r.winnerUserId === u.id,
      winnerUsername: r.winnerUserId ? winnerNames.get(r.winnerUserId) ?? null : null,
      answer: settled ? (lang === "cs" ? r.answerCs : r.answerEn) : null,
      rewardCents: r.rewardCents,
    };
  });
}

// One typed guess against the photo. Identical shape to emojiGuess: the
// partial unique index guarantees exactly one first solver per round.
export async function photoGuess(roundId: string, guessRaw: string): Promise<{ ok: boolean; error?: string; correct?: boolean; attemptsLeft?: number }> {
  try {
    const u = await requireUser();
    if (u.frozenAt) throw new Error("Account frozen");
    const guess = (guessRaw ?? "").trim().slice(0, 120);
    if (!guess) throw new Error("Type a guess");

    let out: { ok: true; correct: boolean; attemptsLeft: number } = { ok: true, correct: false, attemptsLeft: 0 };
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.photoRound).where(eq(schema.photoRound.id, roundId)).for("update").limit(1);
      if (!r) throw new Error("Photo round not found");
      if (!funRoundOpen(r.status, r.closeAt)) throw new Error("This photo round is closed");

      const mine = await tx
        .select()
        .from(schema.photoAttempt)
        .where(and(eq(schema.photoAttempt.roundId, r.id), eq(schema.photoAttempt.userId, u.id)))
        .for("update");
      const left = emojiAttemptsLeft(mine.length);
      if (left <= 0) throw new Error("Out of attempts — wait for the reveal");
      const correct = emojiSolves(guess, r.answerCs, r.answerEn);

      if (correct) {
        await tx.insert(schema.photoAttempt).values({ roundId: r.id, userId: u.id, guess, correct });
        await tx
          .update(schema.photoRound)
          .set({ status: "settled", winnerUserId: u.id, revealedBy: SOLVER_STAMP })
          .where(eq(schema.photoRound.id, r.id));
        const reward = r.rewardCents > 0 ? r.rewardCents : PHOTO_REWARD_CENTS;
        await credit(tx, u.id, reward, "photo", null, "Photo guess — first solver!");
        out = { ok: true, correct: true, attemptsLeft: emojiAttemptsLeft(mine.length + 1) };
      } else {
        await tx.insert(schema.photoAttempt).values({ roundId: r.id, userId: u.id, guess, correct: false });
        out = { ok: true, correct: false, attemptsLeft: left - 1 };
      }
    });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not record your guess";
    if (msg.includes("photo_first_solver_idx") || msg.includes("duplicate key")) {
      return { ok: false, error: "Someone was a hair faster — this photo is solved" };
    }
    return { ok: false, error: msg };
  }
}

// Admin reveal for a photo round nobody solved (or an early close).
export async function photoReveal(roundId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await assertRole("moderator");
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.photoRound).where(eq(schema.photoRound.id, roundId)).for("update").limit(1);
      if (!r) throw new Error("Photo round not found");
      if (r.status === "settled") throw new Error("Already settled");
      await tx.update(schema.photoRound).set({ status: "settled", revealedBy: admin.id }).where(eq(schema.photoRound.id, r.id));
      await audit(tx, admin.id, admin.username ?? "admin", "game.photoReveal", "photo_round", r.id, r.answerCs);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reveal failed" };
  }
}

export async function adminFunCreatePhotoRound(input: {
  imageData: string;
  qCs: string;
  qEn: string;
  answerCs: string;
  answerEn: string;
  hintCs: string;
  hintEn: string;
  closeInHours: number;
  rewardMonos: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await assertRole("moderator");
    if (!photoDataUrlOk(input.imageData ?? "")) throw new Error("Upload a compressed image (JPEG/PNG/WebP)");
    const answerCs = input.answerCs?.trim();
    const answerEn = input.answerEn?.trim();
    if (!answerCs || !answerEn) throw new Error("Write the answer in both languages");
    const hours = Math.max(1, Math.min(24 * 30, Math.round(Number(input.closeInHours) || 24 * 3)));
    const hintAt = new Date(Date.now() + hours * 0.6 * 3_600_000);
    const reward = Math.max(0, Math.round((Number(input.rewardMonos) || 200) * 100));

    await db.transaction(async (tx) => {
      await tx.insert(schema.photoRound).values({
        imageData: input.imageData,
        qCs: input.qCs?.trim() ?? "Co je na fotce?",
        qEn: input.qEn?.trim() ?? "What's in the photo?",
        answerCs,
        answerEn,
        hintCs: input.hintCs?.trim() ?? "",
        hintEn: input.hintEn?.trim() ?? "",
        hintAt,
        closeAt: new Date(Date.now() + hours * 3_600_000),
        rewardCents: reward,
      });
      await audit(tx, admin.id, admin.username ?? "admin", "game.photoCreate", "photo_round", "", (input.qCs ?? "").slice(0, 120));
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not publish the photo" };
  }
}

// ============================================================
// Bracket pools — "tipovačky pavouků" (family games, batch 4)
// ============================================================

export type BracketLeaderboardRow = { username: string; score: number; rewardCents: number };

export type BracketRow = {
  id: string;
  title: string;
  closeAt: string | Date;
  status: "open" | "settled";
  matches: BracketMatch[];
  results: string[] | null; // revealed winners once settled
  entryCount: number;
  myPicks: Record<string, string> | null;
  myScore: number | null;
  myRewardCents: number | null;
  rewardCents: number;
  consolationCents: number;
  leaderboard: BracketLeaderboardRow[];
};

export async function bracketList(limit = 10): Promise<BracketRow[]> {
  const lang: Lang = await getLang();
  const u = await requireUser();

  const pools = await db.select().from(schema.bracketPool).orderBy(desc(schema.bracketPool.createdAt)).limit(limit);
  const ids = pools.map((p) => p.id);
  const picks = ids.length
    ? await db
        .select({
          poolId: schema.bracketPick.poolId,
          userId: schema.bracketPick.userId,
          picks: schema.bracketPick.picks,
          score: schema.bracketPick.score,
          rewardCents: schema.bracketPick.rewardCents,
          username: schema.user.username,
        })
        .from(schema.bracketPick)
        .innerJoin(schema.user, eq(schema.bracketPick.userId, schema.user.id))
        .where(sql`${schema.bracketPick.poolId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
    : [];

  return pools.map((p) => {
    const mine = picks.find((x) => x.poolId === p.id && x.userId === u.id);
    const settled = p.status === "settled";
    const board = picks
      .filter((x) => x.poolId === p.id)
      .map((x) => ({ username: x.username ?? "?", score: x.score, rewardCents: x.rewardCents }))
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
    return {
      id: p.id,
      title: lang === "cs" ? p.titleCs : p.titleEn,
      closeAt: p.closeAt,
      status: (p.status as "open" | "settled") ?? "open",
      matches: (p.matches as BracketMatch[]) ?? [],
      results: settled ? ((p.results as string[]) ?? []) : null,
      entryCount: picks.filter((x) => x.poolId === p.id).length,
      myPicks: mine ? ((mine.picks as Record<string, string>) ?? {}) : null,
      myScore: mine ? mine.score : null,
      myRewardCents: mine ? mine.rewardCents : null,
      rewardCents: p.rewardCents,
      consolationCents: p.consolationCents,
      leaderboard: settled ? board.slice(0, 20) : [],
    };
  });
}

// Submit (or re-edit) the full bracket. One row per player per pool via the
// unique index; freely editable until closeAt locks the picks.
export async function bracketSubmit(poolId: string, picksRaw: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = await requireUser();
    if (u.frozenAt) throw new Error("Account frozen");

    const [pool] = await db.select().from(schema.bracketPool).where(eq(schema.bracketPool.id, poolId)).limit(1);
    if (!pool) throw new Error("Bracket not found");
    if (!funRoundOpen(pool.status, pool.closeAt)) throw new Error("This bracket is closed");
    const matches = (pool.matches as BracketMatch[]) ?? [];

    const picks: Record<string, string> = {};
    for (let i = 0; i < matches.length; i++) {
      const pick = (picksRaw?.[String(i)] ?? "").trim().slice(0, BRACKET_PICK_MAX);
      if (!pick) throw new Error("Fill in a winner for every match");
      picks[String(i)] = pick;
    }

    await db.transaction(async (tx) => {
      // Re-check under lock — the deadline can pass mid-save.
      const [r] = await tx.select().from(schema.bracketPool).where(eq(schema.bracketPool.id, pool.id)).for("update").limit(1);
      if (!r || !funRoundOpen(r.status, r.closeAt)) throw new Error("This bracket is closed");
      await tx
        .insert(schema.bracketPick)
        .values({ poolId: pool.id, userId: u.id, picks })
        .onConflictDoUpdate({ target: [schema.bracketPick.poolId, schema.bracketPick.userId], set: { picks, updatedAt: new Date() } });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your picks" };
  }
}

// Open a new bracket pool. Matches come from a textarea, one per line:
// "QF1 — Sparta vs Slavia | 2" (points optional, default 1).
export async function adminFunCreateBracket(input: {
  titleCs: string;
  titleEn: string;
  closeInHours: number;
  rewardMonos: number;
  consolationMonos: number;
  matchesRaw: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await assertRole("moderator");
    const titleCs = input.titleCs?.trim();
    const titleEn = input.titleEn?.trim();
    if (!titleCs || !titleEn) throw new Error("Write the title in both languages");
    const matches = parseBracketMatches(input.matchesRaw ?? "");
    if (matches.length < 2) throw new Error("List at least 2 matches (one per line)");
    const hours = Math.max(1, Math.min(24 * 365, Math.round(Number(input.closeInHours) || 168)));
    const reward = Math.max(0, Math.round((Number(input.rewardMonos) || 200) * 100));
    const cons = Math.max(0, Math.round((Number(input.consolationMonos) || 50) * 100));

    await db.transaction(async (tx) => {
      await tx.insert(schema.bracketPool).values({
        titleCs: titleCs!,
        titleEn: titleEn!,
        closeAt: new Date(Date.now() + hours * 3_600_000),
        rewardCents: reward,
        consolationCents: cons,
        matches,
        createdBy: admin.id,
      });
      await audit(tx, admin.id, admin.username ?? "admin", "game.bracketCreate", "bracket_pool", "", titleCs ?? "");
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not open the bracket pool" };
  }
}

// Settle a bracket pool: the admin reveals the real winner of every match
// (one per line, same order as the match list). Scoring brackets get paid —
// the top score wins in full, other scoring brackets get the consolation
// token. Nobody with a 0-score bracket is paid.
export async function adminFunSettleBracket(poolId: string, winnersRaw: string): Promise<{ ok: boolean; error?: string; paid?: number }> {
  try {
    const admin = await assertRole("moderator");
    let paid = 0;
    await db.transaction(async (tx) => {
      const [p] = await tx.select().from(schema.bracketPool).where(eq(schema.bracketPool.id, poolId)).for("update").limit(1);
      if (!p) throw new Error("Bracket not found");
      if (p.status === "settled") throw new Error("Already settled");
      const matches = (p.matches as BracketMatch[]) ?? [];

      const winners = (winnersRaw ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim().slice(0, 60))
        .filter(Boolean);
      if (winners.length !== matches.length) throw new Error("Reveal a winner for every match (one per line)");

      const entries = await tx.select().from(schema.bracketPick).where(eq(schema.bracketPick.poolId, p.id)).for("update");
      const winReward = p.rewardCents > 0 ? p.rewardCents : BRACKET_REWARD_CENTS;
      const consReward = Math.max(0, p.consolationCents ?? BRACKET_CONSOLATION_CENTS);

      const scored = entries.map((e) => ({ e, score: bracketScore((e.picks as Record<string, string>) ?? {}, winners, matches) }));
      const top = Math.max(0, ...scored.map((s) => s.score));

      await tx.update(schema.bracketPool).set({ status: "settled", results: winners, settledBy: admin.id }).where(eq(schema.bracketPool.id, p.id));

      for (const { e, score } of scored) {
        const isTop = score > 0 && score === top;
        const amt = isTop ? winReward : score > 0 ? consReward : 0;
        if (amt <= 0) {
          await tx.update(schema.bracketPick).set({ score }).where(eq(schema.bracketPick.id, e.id));
          continue;
        }
        await lockUser(tx, e.userId);
        await credit(tx, e.userId, amt, "bracket", null, isTop ? "Bracket pool — the sharpest bracket" : "Bracket pool — consolation for the near-misses");
        await tx.update(schema.bracketPick).set({ score, rewardCents: amt }).where(eq(schema.bracketPick.id, e.id));
        paid += amt;
      }

      await audit(tx, admin.id, admin.username ?? "admin", "game.bracketSettle", "bracket_pool", p.id, `winners: ${winners.join(", ")}`);
    });
    return { ok: true, paid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not settle the bracket" };
  }
}
