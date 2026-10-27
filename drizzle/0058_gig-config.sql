CREATE TABLE "gig_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dish_pay_cents" integer DEFAULT 300 NOT NULL,
	"math_pay_cents" integer DEFAULT 500 NOT NULL,
	"daily_cap_cents" integer DEFAULT 50000 NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_shift" ADD COLUMN "reversed_at" timestamp with time zone;
INSERT INTO "gig_config" ("dish_pay_cents", "math_pay_cents", "daily_cap_cents") VALUES (300, 500, 50000);
