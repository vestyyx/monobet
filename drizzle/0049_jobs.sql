CREATE TABLE "job_shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"job" text NOT NULL,
	"payload" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"earned_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "job_shift" ADD CONSTRAINT "job_shift_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_shift_user_idx" ON "job_shift" USING btree ("user_id","created_at");