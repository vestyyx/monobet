DROP TABLE "blackjack_round" CASCADE;--> statement-breakpoint
DROP TABLE "dealer_persona" CASCADE;--> statement-breakpoint
DROP TABLE "hilo_round" CASCADE;--> statement-breakpoint
DROP TABLE "jackpot_round" CASCADE;--> statement-breakpoint
DROP TABLE "timer_round" CASCADE;--> statement-breakpoint
DROP TABLE "wall_prayer" CASCADE;--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "rig_bps";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "disabled_games";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "game_max_lev";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "game_lev_caps";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "game_max_bet_cents";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "game_bet_caps";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "autobet_enabled";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "game_daily_limit_ms";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "game_idle_ms";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "game_fee_cents";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "dice_pay_bps";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "limbo_pay_bps";--> statement-breakpoint
ALTER TABLE "casino_config" DROP COLUMN "limbo_min_x100";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "wall_prayer_at";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "vow_bps";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "luck_bps";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "game_session_start";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "game_last_play_at";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "game_played_ms";