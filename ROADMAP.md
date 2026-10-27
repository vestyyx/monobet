# MonoPredict — Development Roadmap & Progress Tracker

> Single source of truth for what's done, what's next and where everything lives.
> Fork of **MonoBet** (upstream: [Dvorinka/monobet](https://github.com/Dvorinka/monobet)) being rebuilt into
> **MonoPredict** — a private, family-and-friends forecasting game. Sunčný, family-friendly, zero gambling.
> Mony (Ɱ) are play points with no monetary value.
>
> Last updated: 2026-10-27 · · All verification = `npx tsc --noEmit` + `npm run lint` + `npx vitest run`

---

## 🎯 Product pillars

1. **Prediction markets** — LMSR-style play-money forecasting (kept from upstream, de-gambled)
2. **Family games corner** — 6 free-play party games with fixed Mony prizes (new)
3. **Private groups** — invite-only family/class groups with per-group settings (Phase 3)
4. **Friendly, warm identity** — never betting jargon; CZ/EN everywhere
5. **Safe admin** — ledger-backed money ops, audit log, role ladder (admin rebuild)

---

## 📊 Milestone overview

| # | Milestone | Status | Commit(s) |
|---|-----------|--------|-----------|
| 1 | De-gambling surgery + MonoPredict rebrand | ✅ done | `85e19ff` |
| 2.1 | Admin architecture + module registry + new shell | ✅ done | `8cfeca2` |
| G1 | Games batch 1: Daily Trivia + Closest Guess | ✅ done | `3600a0b`, `8c36ec2` |
| G2 | Games batch 2: Group Polls + Word/Emoji Guess | ✅ done | `54924ab` (PR #4) |
| G3 | Games batch 3: Family Quests + Photo Guess | ✅ done | `51206da` (PR #5) |
| 2.2 | Player money management + ledger-backed actions + audit log | ✅ done | `1560d53` (PR #6) |
| 3 | Users, groups, approvals queue | ✅ done | `36075eb` (PR #7) |
| 4 | Moderation + suspicious activity | ✅ done | `9cb48f5` (PR #8) |
| 5 | Module admin pages (markets, games, gigs) | ⬜ queued | — |
| 6 | Economy dashboard, config versioning, exports, reconciliation | ⬜ queued | — |
| 7 | Roles/security hardening, UI polish, tests, 2-min demo path | ⬜ queued | — |

---

## ✅ Detailed: what's done

### Milestone 1 — de-gambling + rebrand (`85e19ff`, 49 files, −10k lines)
- [x] Casino, aviator, jackpots, variable bets — **removed entirely**
- [x] Prediction markets kept as the core game (friendly "tipovačka" framing)
- [x] Warm rebrand: copy, logos, landing, disclaimers ("Mony are play points")
- [x] Tone sweep across the whole app (no betting/carousel language)
- [x] CHANGES.md created with upstream attribution

### Milestone 2.1 — admin architecture (`8cfeca2`)
- [x] `lib/admin/rbac.ts` — role ladder **user → moderator → admin → owner** (super-admin email = owner), single `requireRole()` / `assertRole()` gate
- [x] `lib/admin/modules.ts` — **module registry**: every admin-manageable area self-describes (labels CZ/EN, icon, minimum role, delivery phase). Sidebar, dashboard links and `/admin/[section]` routing all generate from it
- [x] `lib/admin/module-views.ts` — serializable registry views
- [x] Migration `0051`: `admin_audit` (immutable log) · `report` (moderation queue) · `config_version` (settings snapshots) · `user.frozen_at / kid_mode / max_stake_cents`
- [x] New shell: registry-driven sidebar (responsive) + live dashboard `/admin` (active today, supply, trades/gigs/duels, pending, reports, recent money movement, warnings)
- [x] `/admin/overview` — original stacked panels kept working until phases 3–6 migrate them
- [x] ~40 i18n keys (EN + CS)

### Games batch 1 (commits `3600a0b` + `8c36ec2`)
- [x] Migration `0052`: `trivia_question` (bilingual bank, unique `shown_day`), `trivia_answer` (unique user+question), `guess_round` + `guess_entry` (unique user+round, re-tunable), `user.trivia_streak`
- [x] `lib/fun.ts` — pure game math: difficulty rewards Ɱ100/150/200 × streak multiplier (cap ×2), ±10% consolation window, clamps; **9 unit tests**
- [x] `lib/actions-fun.ts`:
  - race-safe **daily question pin** (conditional UPDATE + `FOR UPDATE SKIP LOCKED` + unique index — first visitor of the day pins the next bank row)
  - `triviaAnswer` (double-answer proof via unique index; frozen accounts blocked)
  - `guessList` / `guessEnter` / `guessSettle` (closest wins Ɱ, ±10% gets consolation; ties share)
  - admin creators role-gated via `assertRole` + **audit rows in same transaction**
- [x] Player UI: `/games` hub, `/trivia`, `/guess` + nav links (header + mobile)
- [x] Admin UI: `/admin/trivia` (bank curator = the schedule), `/admin/guess` (rounds + reveal/settle) — registry flipped `built: true`, sidebar lights them up automatically
- [x] Ledger kinds `trivia` / `guess` labeled CZ/EN in wallet + profile
- [x] **Live-verified on localhost**: pin → answer → streak → Ɱ165 credit; tip re-tune → settle → Ɱ200 winner payout → audit row
- [x] `scripts/seed-fun.ts` — idempotent demo seeding (3 questions + 1 round)

---

## ✅ Done: games batch 2 (PR #4, `1e2e6c7`, live)

### Games batch 2 — Group Polls + Word/Emoji Guess
- [x] `poll_round` + `poll_vote`: two-option family poll, **minority wins in full** (tie crowns both, empty pays nobody); one vote per player, switchable while open; settle = locked transaction paying per vote + audit with the tally
- [x] `emoji_round` + `emoji_attempt`: emoji riddles, 3 attempts, first correct solver takes the Ɱ150 — enforced by partial unique index `emoji_first_solver_idx`; nudge unlocks at 60 % of the round; answers never ship to the client; expired rounds auto-close lazily
- [x] Admin creators `/admin/polls` + `/admin/word-guess`; registry `built: true`; `/poll` + `/emoji` live; `/games` hub at 4 cards; demo seed extended

## ✅ Done: games batch 3 (PR #5, `88ff472`, live)
- [x] `quest` + `quest_claim`: real-life tasks ("take out the recycling") with `none | text | photo` proof; one claim per quest per player (unique index), rejected claims re-submit and reset to pending; approval pays the fixed reward through the ledger in-transaction + audit `game.questReview`
- [x] `photo_round` + `photo_attempt`: admin publishes a compressed (canvas, ≤ 400 KB data URL stored in DB) photo; 3 guesses, nudge unlocks at 60 %, first correct solver settles and takes the Ɱ200 — enforced by partial unique index `photo_first_solver_idx`; answers never ship while open; expired rounds auto-close lazily (`revealedBy:"auto"`)
- [x] Player pages `/quests` + `/photo` (claim/resubmit states, compressed photo upload with preview); admin `/admin/quests` (creator + review desk with proof-photo thumbs) + `/admin/photo-guess` (pick→compress→publish, guess counts, reveal); registry `built: true`; `/games` hub at 6 cards; ledger kind `photo` labels CZ/EN
- [x] E2E green: claim→approve→ledger `quest` +Ɱ120 + audit; wrong guess burns attempt, "colorful bubbles!!!" settles + pays Ɱ200 `photo`; create + reveal audited (`game.questCreate`/`game.photoCreate`/`game.photoReveal`)

## ⏳ Next: admin phase 2.2 — player money management (approved plan below)

### After games: resume admin rebuild (approved plan below)

---

## 📋 Queued: admin rebuild phases 2–7 (spec from project owner)

### Phase 2.2 — Player money management (next after games)
The core of the spec: **every Mony change goes through the ledger, with a reason, atomically, idempotently, and with role caps.**
- [ ] Player detail page: balance, filterable transaction history, positions, streaks, group memberships, flags
- [ ] `ledgerAdjust()` engine: **grant / deduct / set-to-value (difference entry) / transfer / refund / reverse (counter-entry, original stays visible)** — required reason, per-role caps (moderator < admin < owner), no negative balance unless explicitly allowed, atomic tx, idempotency key
- [ ] Freeze/unfreeze player (`user.frozen_at`) — enforced app-wide (trades, games, claims)
- [ ] Bulk grants: to a group / selected players / all — **preview (”affects 14 players, Ɱ1,400”) → confirm → optional undo**
- [ ] Audit-log page over `admin_audit` (immutable, filterable)
- [ ] Tests: grant/deduct/set/reverse/bulk/limits/negative; every admin endpoint rejects wrong roles; every balance change has ledger + audit rows

### Phase 3 — Users & groups & approvals
- [x] User list: search, filters (role, group, status, new/inactive), sorting; edit profile, role change, force logout, suspend/ban (reason + expiry), kid mode + max stake, merge/flag duplicates
- [x] Groups: members, invite codes (regenerate/disable), per-group economy (currency name, stake limits, allowed games), pause/delete, ownership transfer, **Group Parent role inside their group**
- [x] Approvals queue: new members + user-created markets/questions/gigs — approve/reject/edit with reason message

### Phase 4 — Moderation & safety
- [x] `report` queue UI (comment/market/photo/user/duel) — assign, resolve, dismiss
- [x] Comment/content moderation: hide, delete, warn, shadow-mute; topic blocklist + profanity editor
- [x] Photo Guess uploads reviewed before publish
- [x] Suspicious activity view (multi-account signals, rapid actions, odd streaks)

### Phase 5 — Module admin pages
- [ ] Markets: create/edit/close/resolve/cancel+refund/delete, per-group availability
- [ ] Gigs (jobs): create, review submissions, ledger payouts, per-user limits
- [ ] Migrate the remaining legacy `/admin/overview` panels into dedicated sections (then remove the legacy page)

### Phase 6 — Economy dashboard, settings, exports
- [ ] Economy tools: total supply, distribution (top holders, median), inflation trend, income vs sinks, abnormal-earning alerts
- [ ] Config page over the single config source, saved as `config_version` snapshots — **what changed, who, when; rollback**
- [ ] Announcements/banners (all or selected groups), maintenance mode, registration open/closed
- [ ] Reconciliation check (Σ ledger = Σ balances, mismatches reported) · CSV exports (ledger, users, trades, game results) · seed/reset demo data

### Phase 7 — Hardening & polish
- [ ] Permissions re-checked server-side on every endpoint; CSRF-safe server actions; re-auth prompt for dangerous ops; rate limits; session timeout
- [ ] Destructive actions soft-delete where possible
- [ ] Tables with pagination/filters/bulk select; toasts; dark/light (exists) + tablet layout polish
- [ ] Full test pass + documented **2-minute admin demo path** (dashboard → grant with reason → ledger + audit → approve → resolve → payouts → reconciliation)

---

## 🧱 Architecture decisions (locked)

- **Stack**: Next.js (App Router) + better-auth + Drizzle + Neon Postgres + Tailwind-style utility classes; UI primitives in `components/ui/primitives`
- **Money**: everything through `credit()` (`lib/tx-market.ts`) inside locked transactions; ledger = immutable history; admins NEVER edit balances directly
- **Games**: free-play, fixed small Ɱ rewards, ledger kinds `trivia | guess | poll | emoji | quest`; never wager language
- **i18n**: `lib/i18n.ts` — every new key in BOTH `en` and `cs` sections; content on games stored bilingually in DB
- **Admin**: registry-driven (`lib/admin/modules.ts`); one RBAC gate; audit every mutation

## 🗂 Key files map

| Area | Files |
|---|---|
| DB schema | `lib/db/schema.ts` · migrations in `drizzle/` |
| Game shared math | `lib/fun.ts` (+ `lib/fun.test.ts`) |
| Game actions | `lib/actions-fun.ts` |
| Admin RBAC / registry / dashboard | `lib/admin/rbac.ts` · `modules.ts` · `module-views.ts` · `dashboard.ts` |
| Admin shell | `app/admin/layout.tsx` · `app/admin/page.tsx` · `app/admin/[section]/page.tsx` · `components/admin/admin-nav-item.tsx` |
| Game player pages | `app/games/page.tsx` · `app/trivia/page.tsx` · `app/guess/page.tsx` + `components/trivia-panel.tsx` · `components/guess-panels.tsx` |
| Game admin pages | `app/admin/trivia/page.tsx` · `app/admin/guess/page.tsx` + `components/admin/fun-panels.tsx` |
| Money core | `lib/tx-market.ts` (`credit`, `lockUser`, `ping`) · `lib/actions.ts` |
| i18n | `lib/i18n.ts` (EN ≈ line 20–470, CS ≈ line 890–1340) |
| Ops | `scripts/seed-fun.ts` · `scripts/backdate-guess.ts` · `scripts/check-fun.ts` · `scripts/reset-economy.ts` |

## 🌍 Environments & ops

- **Neon**: project `monopredict` (ID `divine-moon-62709440`, region `aws-eu-central-1`), owner `neondb_owner`; `.env.local` holds pooled + unpooled URLs, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SUPER_ADMIN_EMAIL=tomasskoutny@gmail.com`
- **Migrations**: `npx drizzle-kit generate` (offline) → `npx drizzle-kit migrate` (uses unpooled URL). NEVER use the pooled URL for migrations (PgBouncer transaction mode)
- **Owner/admin**: sign up with the `SUPER_ADMIN_EMAIL` → automatically owner
- **Vercel**: CLI authed as `vestyyx`; deploy = `vercel --prod` (env vars: pooled `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=<prod url>`, `SUPER_ADMIN_EMAIL`)
- **CI**: `.github/workflows/ci.yml` — typecheck + lint + tests per push/PR; PRs must be green before merge

## 📌 Working rules (agreed with the owner)

1. Phases as above; summarize + wait for approval after each
2. Commit per phase/batch; update CHANGES.md; keep upstream attribution
3. Keep stack + style; CZ/EN in sync; clean commented code
4. Tone: party games, never betting
