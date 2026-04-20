-- Migration: organizations.suspended_at
-- @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
--
-- Adds a nullable suspended_at timestamp to the organizations table so the
-- billing worker's creditPositiveReevaluate consumer (triggered by
-- billing.credits_purchased / credits_recharged / dispute_resolved with
-- outcome 'won') can clear the suspension flag atomically when an org's
-- available balance returns to positive.
--
-- The column is also set by usage_cap_exceeded handling (worker activity
-- applyUsageCapExceeded) when the org crosses 100% of its monthly cap, and
-- by dispute_created handling (freezeCreditBalance) when a Stripe charge is
-- disputed. Reading code in the API layer treats `suspended_at IS NOT NULL`
-- as "block all credit-consuming operations until cleared".

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;

-- Optional partial index to make "list suspended orgs" cheap. Suspended orgs
-- are a tiny fraction of the population so partial-index storage cost is
-- negligible and the lookup is constant-time.
CREATE INDEX IF NOT EXISTS "organizations_suspended_at_partial_idx"
  ON "organizations" ("suspended_at")
  WHERE "suspended_at" IS NOT NULL;
