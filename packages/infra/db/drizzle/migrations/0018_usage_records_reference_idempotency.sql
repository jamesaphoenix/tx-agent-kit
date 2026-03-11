CREATE UNIQUE INDEX IF NOT EXISTS usage_records_org_reference_id_unique_idx
  ON usage_records (organization_id, reference_id);
