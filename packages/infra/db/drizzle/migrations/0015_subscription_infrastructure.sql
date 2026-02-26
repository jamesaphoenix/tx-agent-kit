ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_metered_subscription_item_id text;

CREATE TABLE IF NOT EXISTS usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category text NOT NULL,
  quantity bigint NOT NULL,
  unit_cost_decimillicents bigint NOT NULL,
  total_cost_decimillicents bigint NOT NULL,
  reference_id text,
  stripe_usage_record_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_records_org_category_recorded_at_idx
  ON usage_records (organization_id, category, recorded_at);

CREATE INDEX IF NOT EXISTS usage_records_org_recorded_at_idx
  ON usage_records (organization_id, recorded_at);

CREATE INDEX IF NOT EXISTS usage_records_reference_id_idx
  ON usage_records (reference_id);

CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_events_org_created_at_idx
  ON subscription_events (organization_id, created_at);

CREATE INDEX IF NOT EXISTS subscription_events_event_type_created_at_idx
  ON subscription_events (event_type, created_at);

ALTER TABLE credit_ledger
  ALTER COLUMN amount TYPE bigint USING amount::bigint;

ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'adjustment',
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS balance_after bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS credit_ledger_org_created_at_idx
  ON credit_ledger (organization_id, created_at);

CREATE INDEX IF NOT EXISTS credit_ledger_reference_id_idx
  ON credit_ledger (reference_id);
