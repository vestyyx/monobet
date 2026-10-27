// Phase 4 moderation — pure rules, no DB. Mirrors lib/admin-users.ts:
// everything here is unit-tested and must stay import-safe from vitest.
// The DB-facing half lives in lib/actions-admin.ts (audited) and the
// enforcement hooks in lib/actions.ts.

// ---------- blocklist matching ----------

/**
 * Loose "did they really write it" normalizer: lowercase, fold Czech
 * diacritics, map the usual letter-substitution tricks and collapse
 * punctuation noise. Deliberately NOT leetspeak-proof at crypto level —
 * this is a family app, the goal is catching the obvious attempts.
 */
export function normalizeLoose(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacritics
    .replace(/š/g, "s")
    .replace(/ß/g, "ss")
    .replace(/ř/g, "r")
    .replace(/ě/g, "e")
    .replace(/ů|ú/g, "u")
    .replace(/ý|ÿ/g, "y")
    .replace(/0/g, "o")
    .replace(/€/g, "e")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/6/g, "g")
    .replace(/1|!|¡/g, "i")
    .replace(/[|]/g, "l")
    .replace(/\*/g, "")
    .replace(/[^a-z]/g, "");
}

/** A blocklist entry the desk can actually manage: 2–40 chars of content. */
export function blocklistPatternOk(pattern: string): boolean {
  const p = pattern.trim();
  if (p.length < 2 || p.length > 40) return false;
  if (!/[\p{L}\p{N}]/u.test(p)) return false; // not just symbols
  return true;
}

/**
 * First blocklist pattern that survives normalization inside the text,
 * or null. Patterns are normalized the same way at check time, so entries
 * like "HáčKované" still match.
 */
export function blocklistMatch(
  text: string,
  patterns: string[]
): string | null {
  const hay = normalizeLoose(text);
  if (!hay) return null;
  for (const raw of patterns) {
    const needle = normalizeLoose(raw);
    if (needle && hay.includes(needle)) return raw;
  }
  return null;
}

// ---------- reports ----------

export const REPORT_KINDS = ["comment", "market", "photo", "user", "duel"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export function reportKindOk(kind: string): kind is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(kind);
}

/** What the reporter has to say — a sentence so the queue is triageable. */
export function reportReasonOk(reason: string): boolean {
  const r = reason.trim();
  return r.length >= 3 && r.length <= 500;
}

/** Closing note for resolve (verdict) and dismiss (why not actionable). */
export function resolutionNoteOk(note: string): boolean {
  const n = note.trim();
  return n.length >= 5 && n.length <= 500;
}

// ---------- warnings & mutes ----------

/** Comment timeout hours: from 1 hour up to 30 days. */
export function warnHoursOk(hours: number): boolean {
  return Number.isFinite(hours) && hours >= 1 && hours <= 24 * 30;
}

// ---------- suspicious activity ----------

export type SignalInput = {
  /** accounts seen behind one IP in the last 14 days */
  sharedAccounts: number;
  /** the user's trades + comments in the last hour */
  actionsLastHour: number;
  /** this user's game earnings in the last 7 days (cents) */
  weeklyGainCents: number;
  /** median game earnings across active players (cents) */
  medianGainCents: number;
};

export type SuspicionVerdict = {
  level: "none" | "medium" | "high";
  score: number;
};

/**
 * Additive score with fixed thresholds — same shape as the money caps:
 * a reviewer sees WHY something got flagged. 4+ = work the desk now,
 * 2–3 = keep an eye, below 2 = nothing.
 */
export function suspicionVerdict(s: SignalInput): SuspicionVerdict {
  let score = 0;
  if (s.sharedAccounts >= 3) score += 3;
  else if (s.sharedAccounts === 2) score += 1;
  if (s.actionsLastHour >= 40) score += 3;
  else if (s.actionsLastHour >= 15) score += 1;

  const median = Math.max(s.medianGainCents, 100_000); // Ɱ1,000 floor
  if (s.weeklyGainCents >= Math.max(2_500_000, 15 * median)) score += 3;
  else if (s.weeklyGainCents >= Math.max(500_000, 5 * median)) score += 2;
  else if (s.weeklyGainCents >= Math.max(300_000, 3 * median)) score += 1;

  return { level: score >= 4 ? "high" : score >= 2 ? "medium" : "none", score };
}

/**
 * Given everyone's weekly game earnings, return the indices that are
 * runaway outliers (3× the median AND at least Ɱ1,500 absolute).
 */
export function flagOutlierGains(weekGainCents: number[]): number[] {
  if (weekGainCents.length === 0) return [];
  const sorted = [...weekGainCents].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const floor = Math.max(150_000, 3 * median);
  return weekGainCents
    .map((g, i) => (g >= floor ? i : -1))
    .filter((i) => i >= 0);
}
