-- Migration: billing-pricing-spec
-- Aligns DB schema with billing-and-pricing-design.md spec

-- 1. Fix credit_ledger FK: CASCADE -> SET NULL (INV-BILLING-001, INV-BILLING-007)
-- Drop existing FK constraint (may be named differently across migration histories)
DO $$ DECLARE _con text;
BEGIN
  SELECT conname INTO _con FROM pg_constraint
    WHERE conrelid = 'credit_ledger'::regclass
      AND contype = 'f'
      AND EXISTS (
        SELECT 1 FROM unnest(conkey) k
        JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k
        WHERE a.attname = 'organization_id'
      );
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE credit_ledger DROP CONSTRAINT %I', _con);
  END IF;
END $$;
ALTER TABLE "credit_ledger" ALTER COLUMN "organization_id" DROP NOT NULL;
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL;

-- 2. Fix usage_records FK: CASCADE -> SET NULL (INV-BILLING-002, INV-BILLING-007)
DO $$ DECLARE _con text;
BEGIN
  SELECT conname INTO _con FROM pg_constraint
    WHERE conrelid = 'usage_records'::regclass
      AND contype = 'f'
      AND EXISTS (
        SELECT 1 FROM unnest(conkey) k
        JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k
        WHERE a.attname = 'organization_id'
      );
  IF _con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE usage_records DROP CONSTRAINT %I', _con);
  END IF;
END $$;
ALTER TABLE "usage_records" ALTER COLUMN "organization_id" DROP NOT NULL;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL;

-- 3. Rename credit_ledger.amount -> amount_decimillicents for unit clarity
ALTER TABLE "credit_ledger" RENAME COLUMN "amount" TO "amount_decimillicents";

-- 4. Add missing columns to credit_ledger
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "stripe_event_id" TEXT;
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "asset_id" UUID;
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "phase" TEXT;

-- UNIQUE partial index on stripe_event_id (belt-and-suspenders dedup, INV-BILLING-005)
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_stripe_event_id_unique"
  ON "credit_ledger" ("stripe_event_id")
  WHERE "stripe_event_id" IS NOT NULL;

-- 5. Add missing columns to usage_records
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "margin_multiplier" BIGINT;
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "asset_id" UUID;

-- 6. Add payment_grace_period_ends_at to organizations
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "payment_grace_period_ends_at" TIMESTAMPTZ;

-- 7. Create processed_stripe_events table (idempotency fence, INV-BILLING-005)
CREATE TABLE IF NOT EXISTS "processed_stripe_events" (
  "event_id" TEXT PRIMARY KEY,
  "processed_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Create monthly_credits_usage table (per-org per-period usage tracking)
CREATE TABLE IF NOT EXISTS "monthly_credits_usage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "period_start" TIMESTAMPTZ NOT NULL,
  "period_end" TIMESTAMPTZ NOT NULL,
  "credits_used" BIGINT NOT NULL DEFAULT 0,
  "plan_tier" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "monthly_credits_usage_org_period_unique"
  ON "monthly_credits_usage" ("org_id", "period_start");
CREATE INDEX IF NOT EXISTS "monthly_credits_usage_org_id_idx"
  ON "monthly_credits_usage" ("org_id");

-- 9. Create storage_usage table (per-org per-period storage metering)
CREATE TABLE IF NOT EXISTS "storage_usage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "period_start" TIMESTAMPTZ NOT NULL,
  "period_end" TIMESTAMPTZ NOT NULL,
  "current_bytes" BIGINT NOT NULL DEFAULT 0,
  "plan_storage_limit" BIGINT NOT NULL,
  "plan_tier" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "storage_usage_org_period_unique"
  ON "storage_usage" ("org_id", "period_start");
CREATE INDEX IF NOT EXISTS "storage_usage_org_id_idx"
  ON "storage_usage" ("org_id");

-- 10. Create auto_recharge_attempts table
CREATE TABLE IF NOT EXISTS "auto_recharge_attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "amount_decimillicents" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "stripe_payment_intent_id" TEXT,
  "failure_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "auto_recharge_attempts_org_id_idx"
  ON "auto_recharge_attempts" ("organization_id");
CREATE INDEX IF NOT EXISTS "auto_recharge_attempts_status_idx"
  ON "auto_recharge_attempts" ("status");

-- 11. Immutability triggers on credit_ledger (INV-BILLING-001)
-- Allow FK cascade SET NULL (organization_id → NULL on org delete) but block all other mutations.
CREATE OR REPLACE FUNCTION prevent_credit_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  -- Allow FK cascade SET NULL only (pg_trigger_depth() > 0 ensures this is a cascade, not direct SQL)
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 0
     AND NEW.organization_id IS NULL
     AND OLD.organization_id IS NOT NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.amount_decimillicents IS NOT DISTINCT FROM OLD.amount_decimillicents
     AND NEW.entry_type IS NOT DISTINCT FROM OLD.entry_type
     AND NEW.reason IS NOT DISTINCT FROM OLD.reason
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.stripe_event_id IS NOT DISTINCT FROM OLD.stripe_event_id
     AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id
     AND NEW.phase IS NOT DISTINCT FROM OLD.phase
     AND NEW.balance_after IS NOT DISTINCT FROM OLD.balance_after
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'credit_ledger rows are immutable — UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_update_credit_ledger ON credit_ledger;
CREATE TRIGGER no_update_credit_ledger
  BEFORE UPDATE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_ledger_mutation();

DROP TRIGGER IF EXISTS no_delete_credit_ledger ON credit_ledger;
CREATE TRIGGER no_delete_credit_ledger
  BEFORE DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_ledger_mutation();

-- 12. Immutability triggers on usage_records (INV-BILLING-002)
CREATE OR REPLACE FUNCTION prevent_usage_records_mutation() RETURNS TRIGGER AS $$
BEGIN
  -- Allow FK cascade SET NULL only (pg_trigger_depth() > 0 ensures cascade, not direct SQL)
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 0
     AND NEW.organization_id IS NULL
     AND OLD.organization_id IS NOT NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
     AND NEW.unit_cost_decimillicents IS NOT DISTINCT FROM OLD.unit_cost_decimillicents
     AND NEW.total_cost_decimillicents IS NOT DISTINCT FROM OLD.total_cost_decimillicents
     AND NEW.margin_multiplier IS NOT DISTINCT FROM OLD.margin_multiplier
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id
     AND NEW.stripe_usage_record_id IS NOT DISTINCT FROM OLD.stripe_usage_record_id
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
     AND NEW.recorded_at IS NOT DISTINCT FROM OLD.recorded_at
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'usage_records rows are immutable — UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_update_usage_records ON usage_records;
CREATE TRIGGER no_update_usage_records
  BEFORE UPDATE ON usage_records
  FOR EACH ROW EXECUTE FUNCTION prevent_usage_records_mutation();

DROP TRIGGER IF EXISTS no_delete_usage_records ON usage_records;
CREATE TRIGGER no_delete_usage_records
  BEFORE DELETE ON usage_records
  FOR EACH ROW EXECUTE FUNCTION prevent_usage_records_mutation();

-- 13. Add entry_type CHECK constraint
ALTER TABLE "credit_ledger" DROP CONSTRAINT IF EXISTS "credit_ledger_entry_type_check";
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_entry_type_check"
  CHECK ("entry_type" IN ('purchase', 'usage', 'adjustment', 'refund', 'auto_recharge', 'reserve', 'release'));

-- 14. Seed profit_margin in system_settings
INSERT INTO "system_settings" ("key", "value", "description")
VALUES ('profit_margin', '{"multiplier": 1.10}', 'Infrastructure markup multiplier applied to all AI cost pass-through')
ON CONFLICT ("key") DO UPDATE SET "value" = '{"multiplier": 1.10}';
