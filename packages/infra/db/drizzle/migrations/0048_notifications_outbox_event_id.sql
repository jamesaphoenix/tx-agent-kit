-- Migration: notifications outbox-event idempotency
--
-- Adds a partial UNIQUE index on (user_id, organization_id,
-- (metadata->>'outbox_event_id')) so the worker fan-out handler can
-- collapse retries of the same outbox event into a single notification
-- row at the DB level instead of a bounded page scan.
--
-- The previous Phase 1 implementation used
-- notificationsRepository.listForUser(limit=50) and scanned in memory
-- for a matching outbox_event_id. Any organization with more than 50
-- notifications would silently miss the dedup on a retry of an older
-- event, producing duplicate notifications and violating
-- INV-NOTIF-002.
--
-- The partial index is over the JSONB extracted value so existing rows
-- without the metadata key are unaffected and the unique constraint
-- only applies to fan-out-created rows.
--
-- @spec INV-NOTIF-002 — outbox event idempotency

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_outbox_event_id_user_org_uniq_idx"
  ON "notifications" ("user_id", "organization_id", ((metadata->>'outbox_event_id')))
  WHERE metadata->>'outbox_event_id' IS NOT NULL;
