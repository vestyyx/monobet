ALTER TABLE "ledger" ADD COLUMN "idem_key" text;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "batch_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_idem_idx" ON "ledger" USING btree ("idem_key") WHERE "idem_key" is not null;--> statement-breakpoint
CREATE INDEX "ledger_batch_idx" ON "ledger" USING btree ("batch_id") WHERE "batch_id" is not null;