-- Enforce drip-send idempotency at the database level.
--
-- (enrollment_id, step_id) is the natural key for a drip send: the sweep renders
-- and sends exactly one email per enrollment step. The previous plain index let
-- two concurrent render-and-send retries (e.g. a Temporal activity retry racing a
-- still-running attempt) each pass the read-then-insert check and insert a second
-- row. Promoting it to a UNIQUE index makes the insert an atomic upsert so the
-- (enrollment, step) row is created at most once, and lets the activity collapse
-- its idempotency read + insert into a single statement.
--
-- Broadcast sends carry a NULL enrollment_id and must not collide with one
-- another, so the uniqueness is partial (enrollment_id IS NOT NULL). The partial
-- unique index still serves the drip lookup `WHERE enrollment_id = $1 AND
-- step_id = $2`, so the old non-unique index is redundant and dropped.

DROP INDEX IF EXISTS idx_email_sends_enrollment_step;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sends_enrollment_step_unique
  ON email_sends (enrollment_id, step_id)
  WHERE enrollment_id IS NOT NULL;
