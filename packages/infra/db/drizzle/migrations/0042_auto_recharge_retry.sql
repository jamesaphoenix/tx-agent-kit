-- Migration: auto_recharge_attempts.next_retry_at + permanent_failed status
-- @spec billing-and-pricing-design §"Auto-recharge retry policy"
--
-- The auto-recharge retry policy gives a failed off-session PaymentIntent
-- exactly one retry chance, scheduled 48 hours after the original failure.
-- A second failure marks the attempt permanently failed and the org is
-- expected to top up manually (or update their saved payment method via
-- the customer portal).
--
-- Schema additions:
--   * `next_retry_at` — when a `failed` attempt is eligible for a retry.
--     Set by the worker on first failure, cleared (NULL) when the retry
--     fires or the attempt is marked permanent_failed.
--   * `retried_from_attempt_id` — back-pointer from a retry attempt to its
--     original. Populated by the retry scheduler so the audit trail makes
--     it obvious which "failed" rows already had their second chance.
--
-- The `status` column stays a `TEXT NOT NULL DEFAULT 'pending'` to match
-- the existing schema (no enum), but the application-side state machine
-- accepts: pending → succeeded | failed | requires_action | permanent_failed.

ALTER TABLE "auto_recharge_attempts"
  ADD COLUMN IF NOT EXISTS "next_retry_at" TIMESTAMPTZ;

ALTER TABLE "auto_recharge_attempts"
  ADD COLUMN IF NOT EXISTS "retried_from_attempt_id" UUID
    REFERENCES "auto_recharge_attempts"("id") ON DELETE SET NULL;

-- Partial index so the hourly retry-scan query is cheap. Most rows are
-- terminal (succeeded / permanent_failed) so we only index the handful of
-- failed rows that are eligible for a retry.
CREATE INDEX IF NOT EXISTS "auto_recharge_attempts_next_retry_at_partial_idx"
  ON "auto_recharge_attempts" ("next_retry_at")
  WHERE "next_retry_at" IS NOT NULL;
