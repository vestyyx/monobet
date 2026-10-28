CREATE TABLE "platform_config" (
	"id" text PRIMARY KEY DEFAULT 'platform' NOT NULL,
	"registration_open" boolean DEFAULT true NOT NULL,
	"maintenance" boolean DEFAULT false NOT NULL,
	"ann_title" text DEFAULT '' NOT NULL,
	"ann_body" text DEFAULT '' NOT NULL,
	"ann_level" text DEFAULT 'info' NOT NULL,
	"ann_until" timestamp with time zone,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
