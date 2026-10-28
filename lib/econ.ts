// Economy reconciliation (Phase 6) — pure core. Every Mony movement is born a
// ledger row, so Σ ledger per user must equal their stored balance. A drift
// means money appeared or vanished outside the books (an old hard-coded
// migration, a manual DB pokes, or a bug) — the /admin/economy desk reports
// the difference instead of silently trusting the numbers.
export type ReconUser = { id: string; username: string | null; balanceCents: number };
export type ReconLedgerRow = { userId: string; amountCents: number };

export type ReconResult = {
  ledgerSumCents: number;
  balanceSumCents: number;
  diffCents: number; // ledger − balances; 0 = books agree
  broken: { id: string; username: string; diffCents: number }[]; // per-user nonzero diffs
};

export function reconcileEconomy(ledgerRows: ReconLedgerRow[], users: ReconUser[]): ReconResult {
  const book = new Map<string, number>();
  for (const r of ledgerRows) book.set(r.userId, (book.get(r.userId) ?? 0) + r.amountCents);

  let ledgerSumCents = 0;
  let balanceSumCents = 0;
  const broken: ReconResult["broken"] = [];
  for (const u of users) {
    const ledger = book.get(u.id) ?? 0;
    ledgerSumCents += ledger;
    balanceSumCents += u.balanceCents;
    const diff = ledger - u.balanceCents;
    if (diff !== 0) {
      broken.push({ id: u.id, username: u.username ?? "?", diffCents: diff });
    }
  }

  return {
    ledgerSumCents,
    balanceSumCents,
    diffCents: ledgerSumCents - balanceSumCents,
    broken: broken.sort((a, b) => Math.abs(b.diffCents) - Math.abs(a.diffCents)),
  };
}
