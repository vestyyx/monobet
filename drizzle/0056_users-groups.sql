ALTER TABLE "squad" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "squad" ADD COLUMN "invite_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "squad_role" text;--> statement-breakpoint
ALTER TABLE "squad" ADD CONSTRAINT "squad_invite_code_unique" UNIQUE("invite_code");