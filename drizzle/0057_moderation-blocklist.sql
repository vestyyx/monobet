CREATE TABLE "blocklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"added_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocklist_pattern_unique" UNIQUE("pattern")
);
--> statement-breakpoint
CREATE INDEX "blocklist_created_idx" ON "blocklist" USING btree ("created_at");