-- Migration: notifications
--
-- In-app notifications table for the notifications domain. Phase 1 scope
-- is deliberately minimal: no preferences, no digest batching helpers
-- beyond the digest_batch_id column, no dispatch workflows. The billing
-- subsystem will call `NotificationService.create` from a worker handler
-- (Slice 6) once the billing email templates (Slice 5) land.
--
-- Operational data — NOT a financial audit trail. Safe to delete on
-- organization removal (ON DELETE CASCADE) and to prune on retention
-- policies. Contrast with credit_ledger / usage_records which are 7-year
-- retention with ON DELETE SET NULL.
--
-- @spec notifications-design §"Data Model"

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "read_at" timestamptz,
  "digest_batch_id" uuid,
  "emailed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Primary feed query: newest-first per user per org.
CREATE INDEX IF NOT EXISTS "notifications_user_org_created_at_idx"
  ON "notifications" ("user_id", "organization_id", "created_at" DESC);

-- Digest batch drain query — only pending digest rows.
CREATE INDEX IF NOT EXISTS "notifications_digest_batch_pending_idx"
  ON "notifications" ("digest_batch_id")
  WHERE "digest_batch_id" IS NOT NULL AND "emailed_at" IS NULL;

-- Admin audit query: all rows of a given event type for an org.
CREATE INDEX IF NOT EXISTS "notifications_org_event_type_created_at_idx"
  ON "notifications" ("organization_id", "event_type", "created_at" DESC);
