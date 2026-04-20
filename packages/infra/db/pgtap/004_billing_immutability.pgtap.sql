BEGIN;

-- Trigger coverage markers:
-- no_update_credit_ledger
-- no_delete_credit_ledger
-- no_update_usage_records
-- no_delete_usage_records

SELECT plan(9);

-- ── Immutability triggers exist ─────────────────────────────────────────────────

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    JOIN pg_class AS r ON r.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = r.relnamespace
    WHERE t.tgname = 'no_update_credit_ledger'
      AND r.relname = 'credit_ledger'
      AND n.nspname = current_schema()
      AND t.tgisinternal = false
  ),
  '[INV-BILLING-001] credit_ledger immutability trigger (no_update) exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    JOIN pg_class AS r ON r.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = r.relnamespace
    WHERE t.tgname = 'no_delete_credit_ledger'
      AND r.relname = 'credit_ledger'
      AND n.nspname = current_schema()
      AND t.tgisinternal = false
  ),
  '[INV-BILLING-001] credit_ledger immutability trigger (no_delete) exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    JOIN pg_class AS r ON r.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = r.relnamespace
    WHERE t.tgname = 'no_update_usage_records'
      AND r.relname = 'usage_records'
      AND n.nspname = current_schema()
      AND t.tgisinternal = false
  ),
  '[INV-BILLING-002] usage_records immutability trigger (no_update) exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    JOIN pg_class AS r ON r.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = r.relnamespace
    WHERE t.tgname = 'no_delete_usage_records'
      AND r.relname = 'usage_records'
      AND n.nspname = current_schema()
      AND t.tgisinternal = false
  ),
  '[INV-BILLING-002] usage_records immutability trigger (no_delete) exists'
);

-- ── INV-BILLING-007: FK cascade type is SET NULL, not CASCADE ───────────────────
-- Scope the checks to the current schema so stale leftover schemas from
-- earlier test runs (e.g. api_auth_*, wt_*) don't poison the assertion.

SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = rc.constraint_name
      AND tc.constraint_schema = rc.constraint_schema
    WHERE tc.table_name = 'credit_ledger'
      AND tc.table_schema = current_schema()
      AND rc.delete_rule = 'SET NULL'
  ),
  '[INV-BILLING-007] credit_ledger.organization_id FK uses ON DELETE SET NULL'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = rc.constraint_name
      AND tc.constraint_schema = rc.constraint_schema
    WHERE tc.table_name = 'credit_ledger'
      AND tc.table_schema = current_schema()
      AND rc.delete_rule = 'CASCADE'
  ),
  '[INV-BILLING-007] credit_ledger has no CASCADE FK (audit trail protection)'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = rc.constraint_name
      AND tc.constraint_schema = rc.constraint_schema
    WHERE tc.table_name = 'usage_records'
      AND tc.table_schema = current_schema()
      AND rc.delete_rule = 'SET NULL'
  ),
  '[INV-BILLING-007] usage_records.organization_id FK uses ON DELETE SET NULL'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = rc.constraint_name
      AND tc.constraint_schema = rc.constraint_schema
    WHERE tc.table_name = 'usage_records'
      AND tc.table_schema = current_schema()
      AND rc.delete_rule = 'CASCADE'
  ),
  '[INV-BILLING-007] usage_records has no CASCADE FK (audit trail protection)'
);

-- ── INV-BILLING-005: Belt-and-suspenders Stripe webhook dedup ───────────────
-- credit_ledger.stripe_event_id must have a partial unique index
-- (unique when non-null) so duplicate Stripe events cannot double-apply
-- ledger side effects even if processed_stripe_events is bypassed.

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'credit_ledger'
      AND indexdef LIKE '%stripe_event_id%'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%WHERE%stripe_event_id IS NOT NULL%'
  ),
  '[INV-BILLING-005] credit_ledger has partial unique index on stripe_event_id (dedup belt-and-suspenders)'
);

SELECT * FROM finish();

ROLLBACK;
