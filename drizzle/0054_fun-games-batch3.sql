CREATE TABLE "photo_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"guess" text NOT NULL,
	"correct" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_data" text NOT NULL,
	"q_cs" text NOT NULL,
	"q_en" text NOT NULL,
	"answer_cs" text NOT NULL,
	"answer_en" text NOT NULL,
	"hint_cs" text DEFAULT '' NOT NULL,
	"hint_en" text DEFAULT '' NOT NULL,
	"hint_at" timestamp with time zone NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reward_cents" integer DEFAULT 20000 NOT NULL,
	"winner_user_id" text,
	"revealed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_cs" text NOT NULL,
	"title_en" text NOT NULL,
	"desc_cs" text DEFAULT '' NOT NULL,
	"desc_en" text DEFAULT '' NOT NULL,
	"reward_cents" integer DEFAULT 10000 NOT NULL,
	"proof_kind" text DEFAULT 'none' NOT NULL,
	"proof_ask_cs" text DEFAULT '' NOT NULL,
	"proof_ask_en" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quest_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"photo_data" text,
	"reward_cents" integer DEFAULT 0 NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "photo_attempt" ADD CONSTRAINT "photo_attempt_round_id_photo_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."photo_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_attempt" ADD CONSTRAINT "photo_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest" ADD CONSTRAINT "quest_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_claim" ADD CONSTRAINT "quest_claim_quest_id_quest_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_claim" ADD CONSTRAINT "quest_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photo_first_solver_idx" ON "photo_attempt" USING btree ("round_id") WHERE correct;--> statement-breakpoint
CREATE INDEX "photo_attempt_round_idx" ON "photo_attempt" USING btree ("round_id","user_id");--> statement-breakpoint
CREATE INDEX "photo_round_status_idx" ON "photo_round" USING btree ("status","close_at");--> statement-breakpoint
CREATE INDEX "quest_active_idx" ON "quest" USING btree ("active","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_claim_once_idx" ON "quest_claim" USING btree ("quest_id","user_id");--> statement-breakpoint
CREATE INDEX "quest_claim_status_idx" ON "quest_claim" USING btree ("status","created_at");