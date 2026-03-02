-- Replace the no-op unique index with a partial unique index that only
-- enforces uniqueness when reference_id is NOT NULL.
-- NULL reference_id rows are distinct usage events that don't need idempotency.
DROP INDEX IF EXISTS "usage_records_org_reference_id_unique_idx";

CREATE UNIQUE INDEX "usage_records_org_reference_id_unique_idx"
  ON "usage_records" ("organization_id", "reference_id")
  WHERE "reference_id" IS NOT NULL;
