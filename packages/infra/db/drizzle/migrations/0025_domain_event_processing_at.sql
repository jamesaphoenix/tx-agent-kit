-- Add processing_at column and stuck-processing partial index for recovery
ALTER TABLE "domain_events" ADD COLUMN IF NOT EXISTS "processing_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "domain_events_stuck_processing_idx"
  ON "domain_events" ("status", "processing_at")
  WHERE "status" = 'processing';
