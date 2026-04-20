-- Migration: unique partial index — one pending auto_recharge_attempt per org
-- @spec billing-and-pricing-design §"Auto-recharge"
-- @spec INV-BILLING-010 — billing consumers must be idempotent under concurrency
--
-- Two concurrent `billing.credits_low_balance` events for the same org must
-- collapse to a single Stripe charge and a single ledger row. The current
-- runAutoRechargeTrigger path does a check-then-insert: `findLatestPending`
-- followed by `createPending` if nothing is in flight. Under parallel
-- invocation both fibers can pass the check and then both insert, producing
-- two pending rows and — because each carries its own `attempt_id` which is
-- used as the Stripe idempotency key — two distinct PaymentIntents.
--
-- This unique partial index forces the DB to serialise the race: whichever
-- fiber's INSERT wins commits the sole pending row; the loser must either
-- re-read and reuse it or fall through. The application path handles the
-- conflict by falling back to `findLatestPendingForOrganization`.

CREATE UNIQUE INDEX IF NOT EXISTS "auto_recharge_attempts_one_pending_per_org_uniq_idx"
  ON "auto_recharge_attempts" ("organization_id")
  WHERE "status" = 'pending';
