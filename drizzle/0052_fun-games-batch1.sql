CREATE TABLE "guess_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value" bigint NOT NULL,
	"reward_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guess_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_cs" text NOT NULL,
	"prompt_en" text NOT NULL,
	"unit_cs" text DEFAULT '' NOT NULL,
	"unit_en" text DEFAULT '' NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"answer_value" bigint,
	"status" text DEFAULT 'open' NOT NULL,
	"reward_cents" integer DEFAULT 20000 NOT NULL,
	"consolation_cents" integer DEFAULT 5000 NOT NULL,
	"created_by" text,
	"settled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trivia_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"question_id" uuid NOT NULL,
	"chosen" integer NOT NULL,
	"correct" boolean NOT NULL,
	"reward_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trivia_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"q_cs" text NOT NULL,
	"q_en" text NOT NULL,
	"options_cs" jsonb NOT NULL,
	"options_en" jsonb NOT NULL,
	"correct_idx" integer NOT NULL,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"reward_cents" integer,
	"shown_day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "trivia_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "guess_entry" ADD CONSTRAINT "guess_entry_round_id_guess_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."guess_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guess_entry" ADD CONSTRAINT "guess_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guess_round" ADD CONSTRAINT "guess_round_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_answer" ADD CONSTRAINT "trivia_answer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_answer" ADD CONSTRAINT "trivia_answer_question_id_trivia_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."trivia_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guess_entry_once_idx" ON "guess_entry" USING btree ("round_id","user_id");--> statement-breakpoint
CREATE INDEX "guess_entry_round_idx" ON "guess_entry" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "guess_round_status_idx" ON "guess_round" USING btree ("status","close_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trivia_answer_once_idx" ON "trivia_answer" USING btree ("user_id","question_id");--> statement-breakpoint
CREATE INDEX "trivia_answer_user_idx" ON "trivia_answer" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trivia_bank_day_idx" ON "trivia_question" USING btree ("shown_day");