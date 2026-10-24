CREATE TABLE "emoji_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"guess" text NOT NULL,
	"correct" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emoji_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emoji" text NOT NULL,
	"answer_cs" text NOT NULL,
	"answer_en" text NOT NULL,
	"hint_cs" text DEFAULT '' NOT NULL,
	"hint_en" text DEFAULT '' NOT NULL,
	"hint_at" timestamp with time zone NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reward_cents" integer DEFAULT 15000 NOT NULL,
	"winner_user_id" text,
	"revealed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"q_cs" text NOT NULL,
	"q_en" text NOT NULL,
	"a_cs" text NOT NULL,
	"a_en" text NOT NULL,
	"b_cs" text NOT NULL,
	"b_en" text NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reward_cents" integer DEFAULT 10000 NOT NULL,
	"consolation_cents" integer DEFAULT 0 NOT NULL,
	"winning_side" text,
	"created_by" text,
	"settled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"side" text NOT NULL,
	"reward_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emoji_attempt" ADD CONSTRAINT "emoji_attempt_round_id_emoji_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."emoji_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emoji_attempt" ADD CONSTRAINT "emoji_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_round" ADD CONSTRAINT "poll_round_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_poll_id_poll_round_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."poll_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "emoji_first_solver_idx" ON "emoji_attempt" USING btree ("round_id") WHERE correct;--> statement-breakpoint
CREATE INDEX "emoji_attempt_round_idx" ON "emoji_attempt" USING btree ("round_id","user_id");--> statement-breakpoint
CREATE INDEX "emoji_round_status_idx" ON "emoji_round" USING btree ("status","close_at");--> statement-breakpoint
CREATE INDEX "poll_round_status_idx" ON "poll_round" USING btree ("status","close_at");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_vote_once_idx" ON "poll_vote" USING btree ("poll_id","user_id");--> statement-breakpoint
CREATE INDEX "poll_vote_poll_idx" ON "poll_vote" USING btree ("poll_id");