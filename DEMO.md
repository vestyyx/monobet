# MonoPredict — 2-minute admin demo

A short, safe path through the admin rebuild for a stakeholder demo. Everything below is
play-money (Ɱ) on a private family app — nothing financial, nothing destructive: the demo
grant and the resolved market are small, reversible and fully audited.

Sign in as an admin (the owner account, or any account promoted via `/admin/players`).

| # | Where | What you show | What to point out |
|---|-------|---------------|-------------------|
| 1 | `/admin` | The live dashboard: active players today, open supply, trades/gigs/duels, pending items, recent money movement | Everything is real-time from the ledger — no cached counters |
| 2 | `/admin/money` | Grant Ɱ 25 to a player with a reason ("Demo — welcome top-up") | Money **always** moves through the ledger with a required reason; role caps (`user → moderator → admin → owner`) and an idempotency key prevent double-click accidents |
| 3 | `/admin/audit-log` | Filter by family `money.` | The grant from step 2 is already there — who, what, target, before→after, reason, when; the log is append-only |
| 4 | `/admin/approvals` | Approve (or reject) a player-created market/question/gig — approval carries a reason message | Refused items never phantom-write: the op runs first, the audit row lands only on success |
| 5 | `/admin/markets` | Resolve a live market YES with a reason | Winners are paid atomically in-transaction (`market.resolve`); the detail page shows the outcome banner |
| 6 | `/admin/economy` | The books check: **Σ ledger = Σ balances Ɱ-for-Ɱ**, then the config undo points | Rollback demo (optional): save leverage 10 → 9 with a reason, then roll the undo point back — every step audited; the version stores the values being *overwritten*, so an accidental rollback is itself reversible |
| 7 | `/admin/economy/export/balances` | Download the balances CSV (drift column = balance − Σ ledger per player) | Signed-out requests get 403 — exports are admin-only route handlers |
| 8 | `/admin/settings` | Flip the announcement banner (info) with a reason, then switch it off | One audit row **per changed section**; maintenance mode blocks every player action at the central gate while admins keep working; the registration switch 403s sign-ups server-side |

Fallback talking points if a step is skipped: moderation desk (`/admin/moderation`) — reports
queue + suspicious-activity alerts; games desks under **Games** in the sidebar (trivia bank,
guess rounds, polls, word/emoji riddles, quests review, photo guess).

## Resetting after the demo

- The step-2 grant can be undone on the same desk (reverse/counter-entry keeps the original visible).
- The announcement banner is switched off in step 8 itself.
- Resolved markets are terminal by design — resolve a small demo market, not a seasonal one.
- Deleted markets are soft-deleted: rows and trade history stay; the admin markets desk can
  filter by **Deleted** to review them.
