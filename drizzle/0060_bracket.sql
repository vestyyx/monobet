CREATE TABLE "bracket_pick" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"picks" jsonb NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"reward_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bracket_pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_cs" text NOT NULL,
	"title_en" text NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reward_cents" integer DEFAULT 20000 NOT NULL,
	"consolation_cents" integer DEFAULT 5000 NOT NULL,
	"matches" jsonb NOT NULL,
	"results" jsonb,
	"created_by" text,
	"settled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bracket_pick" ADD CONSTRAINT "bracket_pick_pool_id_bracket_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."bracket_pool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_pick" ADD CONSTRAINT "bracket_pick_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_pool" ADD CONSTRAINT "bracket_pool_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bracket_pick_once_idx" ON "bracket_pick" USING btree ("pool_id","user_id");--> statement-breakpoint
CREATE INDEX "bracket_pick_pool_idx" ON "bracket_pick" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "bracket_pool_status_idx" ON "bracket_pool" USING btree ("status","close_at");