BEGIN;

SELECT plan(11);

-- @spec INV-AST-002
-- NOT NULL: team_media_assets.team_id
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_attribute AS a
    JOIN pg_class AS r ON r.oid = a.attrelid
    WHERE r.relname = 'team_media_assets'
      AND a.attname = 'team_id'
      AND a.attnotnull
  ),
  'team_media_assets.team_id is NOT NULL'
);

-- FK: team_media_assets.team_id → teams.id
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_class AS r ON r.oid = c.conrelid
    WHERE c.contype = 'f'
      AND r.relname = 'team_media_assets'
      AND c.conname = 'team_media_assets_team_id_teams_id_fkey'
  ),
  'team_media_assets has FK to teams'
);

-- FK: pending_uploads.team_id → teams.id
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_class AS r ON r.oid = c.conrelid
    WHERE c.contype = 'f'
      AND r.relname = 'pending_uploads'
      AND c.conname = 'pending_uploads_team_id_teams_id_fkey'
  ),
  'pending_uploads has FK to teams'
);

-- FK: storage_metering.organization_id → organizations.id
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_class AS r ON r.oid = c.conrelid
    WHERE c.contype = 'f'
      AND r.relname = 'storage_metering'
      AND c.conname = 'storage_metering_organization_id_organizations_id_fkey'
  ),
  'storage_metering has FK to organizations'
);

-- FK: media_collections.team_id → teams.id
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_class AS r ON r.oid = c.conrelid
    WHERE c.contype = 'f'
      AND r.relname = 'media_collections'
      AND c.conname = 'media_collections_team_id_teams_id_fkey'
  ),
  'media_collections has FK to teams'
);

-- @spec INV-AST-007
-- Partial unique index: (team_id, content_hash) WHERE is_deleted = false
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename = 'team_media_assets'
      AND indexname = 'team_media_assets_team_content_hash_unique'
  ),
  'team_media_assets has partial unique index on (team_id, content_hash)'
);

-- CHECK: team_media_assets.file_size >= 0
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_class AS r ON r.oid = c.conrelid
    WHERE c.contype = 'c'
      AND r.relname = 'team_media_assets'
      AND c.conname = 'team_media_assets_file_size_non_negative'
  ),
  'team_media_assets.file_size has non-negative CHECK constraint'
);

-- CHECK: storage_metering.active_bytes >= 0
-- @spec INV-AST-004
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_class AS r ON r.oid = c.conrelid
    WHERE c.contype = 'c'
      AND r.relname = 'storage_metering'
      AND c.conname = 'storage_metering_active_bytes_non_negative'
  ),
  'storage_metering.active_bytes has non-negative CHECK constraint'
);

-- @spec INV-AST-015
-- UNIQUE: storage_usage (org_id, period_start)
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename = 'storage_usage'
      AND indexname = 'storage_usage_org_period_unique'
  ),
  'storage_usage has unique index on (org_id, period_start)'
);

-- Retention scan index exists
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename = 'team_media_assets'
      AND indexname = 'team_media_assets_retention_scan_idx'
  ),
  'team_media_assets has retention scan partial index'
);

-- FK: storage_usage.org_id → organizations.id
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_class AS r ON r.oid = c.conrelid
    JOIN pg_class AS f ON f.oid = c.confrelid
    WHERE c.contype = 'f'
      AND r.relname = 'storage_usage'
      AND f.relname = 'organizations'
  ),
  'storage_usage has FK to organizations'
);

SELECT * FROM finish();

ROLLBACK;
