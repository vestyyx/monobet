# MonoPredict — Change Log

This fork of **MonoBet** (upstream: https://github.com/Dvorinka/monobet) is being reworked into **MonoPredict** — a private, family-and-friends forecasting game. Sunčný, family-friendly, no gambling. Mony (Ɱ) are play points with no monetary value.

## Phase 2 — admin panel rebuild (in progress)

### 2.1 Architecture + module registry (committed)
- `lib/admin/rbac.ts` — role ladder **user → moderator → admin → owner** (super-admin email = owner), `requireRole`/`assertRole` as the single server-side gate for every admin endpoint.
- `lib/admin/modules.ts` — **module registry**: markets, gigs, all planned family games, money, groups, moderation, approvals, economy, settings, audit-log — each with CZ/EN labels, icon, minimum role and delivery phase. Sidebar, dashboard quick links and section routing generate from it (adding/flagging a module updates the whole panel).
- New tables (migration `0051_phase2-admin-core.sql`): `admin_audit` (immutable log), `report` (moderation queue), `config_version` (settings snapshots); `user` gains `frozen_at` / `kid_mode` / `max_stake_cents`.
- New shell: registry-driven sidebar (responsive, tablet-friendly), **live dashboard** `/admin` (active today, supply, trades/gigs/duels today, pending approvals, reports, recent money movement, warnings) and `/admin/[section]` stubs for not-yet-built modules. The original stacked panels remain at `/admin/overview` until phases 3–6 migrate them.

## Phase 1 — de-gambling surgery + friendly rebrand (committed)

### Removed entirely — the casino
- **All 10 casino minigames** (coin flip, dice, stop-the-timer, limbo, wheel, slots, plinko, hi-lo, red-or-black, blackjack) with their routes (`/games`), UI panel, tests, and server actions.
- **Dealer personas** (admin-configed casino "characters", incl. rigging knobs), the `blackjack_round`, `timer_round`, `hilo_round`, `jackpot_round`, `wall_prayer` tables and the `dealer_persona` table.
- **Daily jackpot** (raffle over wagers) — action, query, rewards constants, i18n, ledger labels.
- **Rigging & luck**: house `rig_bps` cheat, per-player `luck_bps` tuning, admin kill-switch and per-game leverage/bet caps, autobet, game session time-limits.
- **"Wall of Debts"** prayer mechanic (candles, vows, miracles, profanity-adjacent theatre) — loans stay as plain boring debt until the economy phase.
- **Offensive easter-egg personas** and rigged-house surprise celebrations, plus their CSS scenes.
- Casino admin panels (rig, luck, per-game toggles/caps, dealers); house panel now covers only trade leverage, fees, loan APR and referral royalties.
- Duels trimmed to friendly kinds: **claim** (agree-a-bet), **rock-paper-scissors**, **high-roll (d100)**.

### Rebranded — family-friendly look & tone
- New palette in `app/globals.css`: warm apricot brand (`#f08a1d`), cream canvas, cocoa dark mode, softer yes/no greens/reds, rounder cards (16 px radius).
- New logo mark: friendly rising-sun glyph in `components/logo.tsx`, `app/icon.svg`.
- Footer/tagline copy now says "a forecasting game for friends — just for fun, Mony have no monetary value" (EN + CZ).
- Brand strings cleaned: `monopredict.local` emails, notif storage keys, share filenames, OG text "pro zábavu · nemá peněžní hodnotu".

### Kept on purpose (later phases will revisit)
- Prediction markets (LMSR prices = fun crowd guesses), jobs ("Brigády" → family quests later), squads, leaderboard, bonuses, daily faucet — all with play money.
- Upstream LICENSE/attribution and the GitHub source link in the footer.

### Migration
- `drizzle/0050_phase1-no-casino.sql` — drops the casino tables and the gambling columns on `user` / `casino_config`.

### Verification
- `npx tsc --noEmit` → 0 errors; `npm run lint` → 0 errors (3 pre-existing upstream warnings); `npx vitest run` → 39 tests passing.
