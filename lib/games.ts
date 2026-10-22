// Friendly party-game logic — duels only (the casino minigames were removed;
// family games like trivia and closest-guess arrive in a later phase).

// Duels — claim is the classic agreed bet; rps and roll are server-resolved
// party games where both sides make one move and the better result takes the
// pot. Game rounds are free; only the locked stake moves.
export const DUEL_KINDS = [
  "claim", "rps", "roll",
] as const;
export type DuelKind = (typeof DUEL_KINDS)[number];
export const RPS_MOVES = ["rock", "paper", "scissors"] as const;
export type RpsMove = (typeof RPS_MOVES)[number];
// rock > scissors > paper > rock — index beats (index + 1) % 3 loses
export const RPS_BEATS: Record<RpsMove, RpsMove> = { rock: "scissors", paper: "rock", scissors: "paper" };
// Game kinds carry a canonical English label as their claim text — the panel
// localizes the label from `kind`, ledger memos just need something readable.
export const DUEL_NAMES: Record<DuelKind, string> = {
  claim: "Custom bet",
  rps: "Rock Paper Scissors",
  roll: "High roll",
};

// A duel move: a primitive (rps pick or drawn number).
export type DuelMove = string | number;

// Scrub a duel's move map for one viewer: the opponent's move is replaced by
// a {hidden} marker until settlement so live picks can't be peeked in props.
// The opponent's done flag survives — the UI can tell playing vs locked in.
export function hideDuelMoves<T>(state: T, viewerId: string, settled: boolean): T {
  const st = state as { moves?: Record<string, DuelMove> } | null;
  if (settled || !st?.moves) return state;
  const moves = { ...st.moves };
  for (const k of Object.keys(moves)) {
    if (k !== viewerId) moves[k] = "+hidden";
  }
  return { ...st, moves } as T;
}
