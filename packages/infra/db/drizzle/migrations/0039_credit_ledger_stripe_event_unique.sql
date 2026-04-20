-- [INV-BILLING-005] Belt-and-suspenders Stripe webhook dedup.
-- processed_stripe_events.event_id is already the primary key; add a
-- partial unique index on credit_ledger(stripe_event_id) so any attempt
-- to double-apply a Stripe webhook side effect is rejected by the
-- financial audit trail itself. NULL stripe_event_id rows (non-Stripe
-- ledger entries) remain unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_stripe_event_id_unique_idx"
  ON "credit_ledger" ("stripe_event_id")
  WHERE "stripe_event_id" IS NOT NULL;
