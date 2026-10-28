// Family-game shared constants & math — deliberately pure and unit-testable
// (fun.test.ts). All rewards are small fixed Mony amounts: party-game prizes,
// never stakes, never winnings of a wager.

// ---------- shared helpers ----------
// UTC day string used as the trivia "shownDay" key. Inlined (instead of
// importing lib/activity) so this module stays DB-free and testable.
export function funToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------- trivia ----------
// Base reward by difficulty (in cents; Ɱ100 / Ɱ150 / Ɱ200).
export const TRIVIA_REWARD_BY_DIFFICULTY: Record<number, number> = {
  1: 10_000,
  2: 15_000,
  3: 20_000,
};

export const TRIVIA_MAX_STREAK_MULT = 2; // multiplier ceiling
export const TRIVIA_STREAK_STEP = 0.1; // +10% per consecutive correct answer

// Multiplier for a player whose CURRENT consecutive-correct streak is `streak`
// (0 for a player whose last answer was wrong). Streak of 0 → ×1.0, grows by
// +10% per streak day until it caps at ×2.0. Kept pure for tests.
export function funStreakMultiplier(streak: number): number {
  const s = Math.max(0, Math.min(10, Math.floor(streak)));
  return Math.min(1 + s * TRIVIA_STREAK_STEP, TRIVIA_MAX_STREAK_MULT);
}

// Final reward for a correct answer: base × streak multiplier earned *after*
// this correct answer (streak counts the answer being paid out).
export function triviaRewardCents(priorStreak: number, difficulty: number, overrideCents?: number | null): number {
  const base = overrideCents && overrideCents > 0 ? overrideCents : TRIVIA_REWARD_BY_DIFFICULTY[difficulty] ?? TRIVIA_REWARD_BY_DIFFICULTY[1];
  return Math.round(base * funStreakMultiplier(priorStreak + 1));
}

// ---------- closest guess ----------
// Default winner reward Ɱ200 + Ɱ50 consolation for everyone inside the window.
export const GUESS_REWARD_CENTS = 20_000;
export const GUESS_CONSOLATION_CENTS = 5_000;
// A guess within ±10% of the truth earns the consolation prize.
export const GUESS_CONSOLATION_WINDOW_PCT = 10;

export function guessWithinWindow(value: number, answer: number): boolean {
  if (answer === 0) return value === 0;
  return Math.abs(value - answer) <= Math.abs((answer * GUESS_CONSOLATION_WINDOW_PCT) / 100);
}

// Distance metric used to crown the closest entry — absolute difference both
// ways works for counts and sizes alike.
export function guessDistance(value: number, answer: number): number {
  return Math.abs(value - answer);
}

// ---------- closeness helpers ----------

// Whether a closest-guess round still accepts entries — called from BOTH
// player and admin pages. Lives here so the impure clock read stays out of
// component scope (render purity rule).
export function guessRoundOpen(status: string, closeAt: string | number | Date): boolean {
  if (status !== "open") return false;
  return new Date(closeAt).getTime() > Date.now();
}

// Sanity clamp for guess entry values — friendly but bounded (no 10^15).
export function guessClampValue(value: number): number {
  const v = Math.round(value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1_000_000_000, Math.min(1_000_000_000, v));
}

// ---------- group polls ----------
// Default minority-wins prize per voter (Ɱ100); the majority side earns only
// the consolation token when the admin turns it on (often off — the joke IS
// being in the losing crowd).
export const POLL_REWARD_CENTS = 10_000;

// Minority-wins logic. Given per-side vote counts, the smaller side wins.
// A tie (equal nonzero counts) means BOTH sides win in full — friendlier than
// splitting hairs. No votes at all → nobody wins.
// Returns 'a' | 'b' | 'both' | null.
export function pollMinoritySide(countA: number, countB: number): "a" | "b" | "both" | null {
  if (countA < countB) return "a";
  if (countB < countA) return "b";
  return countA > 0 ? "both" : null;
}

// ---------- word/emoji riddles ----------
export const EMOJI_MAX_ATTEMPTS = 3;
// Default prize for the first solver (Ɱ150).
export const EMOJI_REWARD_CENTS = 15_000;

// Attempts a player has left (never negative — 0 means locked out).
export function emojiAttemptsLeft(used: number): number {
  return Math.max(0, EMOJI_MAX_ATTEMPTS - Math.max(0, used));
}

// Normalized comparison for typed answers: case-, diacritic-, punctuation-
// and whitespace-insensitive. "PapancÍ s  jablky!!!" and "papancí s jablky"
// must count as the same recipe. NFD + strip combining marks handles
// Czech/English accents; everything non-alphanumeric is dropped.
export function emojiNormalize(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// Whether a typed guess solves a round: matches either the CZ or the EN
// answer after normalization.
export function emojiSolves(guess: string, answerCs: string, answerEn: string): boolean {
  const g = emojiNormalize(guess);
  return g.length > 0 && (g === emojiNormalize(answerCs) || g === emojiNormalize(answerEn));
}

// Shared clock helper for poll/emoji rounds (impure Date.now() read stays out
// of component render scope — see guessRoundOpen).
export function funRoundOpen(status: string, closeAt: string | number | Date): boolean {
  if (status !== "open") return false;
  return new Date(closeAt).getTime() > Date.now();
}

// ---------- bracket pools ----------
// Season-long bracket pools ("tipovačky pavouků"): the admin lists the matches
// (each worth points), players submit a winner per match until the deadline,
// then the admin reveals the real winners and the best brackets get paid.
export const BRACKET_REWARD_CENTS = 20_000; // Ɱ200 for the top bracket
export const BRACKET_CONSOLATION_CENTS = 5_000; // token for other scoring brackets
export const BRACKET_MAX_MATCHES = 64; // family-scale tournaments only
export const BRACKET_PICK_MAX = 60; // chars per pick (a team/country name)
export const BRACKET_MATCH_LABEL_MAX = 120;

export type BracketMatch = { label: string; points: number };

// Parse the admin textarea: one match per line, "label | points" — points
// optional (default 1, clamped 1..100). Lines past the cap are dropped.
export function parseBracketMatches(raw: string): BracketMatch[] {
  const lines = (raw ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: BracketMatch[] = [];
  for (const line of lines) {
    let label = line;
    let points = 1;
    const parts = line.split("|");
    if (parts.length >= 2) {
      const tail = Number(parts[parts.length - 1].trim());
      if (Number.isFinite(tail)) {
        label = parts.slice(0, -1).join("|").trim();
        points = Math.max(1, Math.min(100, Math.round(tail)));
      }
    }
    if (!label) continue;
    out.push({ label: label.slice(0, BRACKET_MATCH_LABEL_MAX), points });
    if (out.length >= BRACKET_MAX_MATCHES) break;
  }
  return out;
}

// Score a bracket: points for every match where the pick equals the revealed
// winner (normalized — case, diacritics and punctuation don't matter, same
// semantics as the riddle answers).
export function bracketScore(picks: Record<string, string>, winners: string[], matches: BracketMatch[]): number {
  return matches.reduce((sum, m, i) => {
    const pick = picks?.[String(i)] ?? "";
    const win = winners[i] ?? "";
    const np = emojiNormalize(pick);
    return sum + (np.length > 0 && np === emojiNormalize(win) ? m.points : 0);
  }, 0);
}

// ---------- family quests ----------
// Default payout for an approved quest claim (Ɱ100); the admin sets it per
// quest, small fixed amounts only.
export const QUEST_REWARD_CENTS = 10_000;

// Validate a submitted proof note / photo without touching the DB:
// notes are capped short (it's a claim message, not an essay), photos must be
// data URLs of a sane, family-friendly size (client compresses to ≤ ~250 KB).
export const QUEST_PROOF_NOTE_MAX = 400;
export const PHOTO_DATA_URL_MAX = 400_000; // chars of "<data URL>"

export function questProofNoteOk(note: string): boolean {
  return (note ?? "").trim().length <= QUEST_PROOF_NOTE_MAX;
}

export function photoDataUrlOk(dataUrl: string): boolean {
  return /^data:image\/(jpeg|png|webp);base64,/.test(dataUrl ?? "") && (dataUrl ?? "").length <= PHOTO_DATA_URL_MAX;
}

// ---------- photo guess ----------
export const PHOTO_MAX_ATTEMPTS = 3;
// Default first-solver prize (Ɱ200) — macro shots are harder than emoji.
export const PHOTO_REWARD_CENTS = 20_000;

// First-solver "one correct attempt row" race safety is enforced by the photo
// partial unique index; the answer comparison reuses emojiSolves/emojiNormalize
// (identical CZ/EN typed-answer semantics for both riddle families).
