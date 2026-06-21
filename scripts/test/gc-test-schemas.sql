-- Garbage-collect leaked per-run integration test schemas.
--
-- Every integration suite creates a schema named `<prefix>_<uuidv7-hex>` via
-- testkit's buildSchemaName and drops it in teardown. Killed runs (budget
-- kills, crashes) skip teardown, so long-lived databases accumulate schemas
-- forever: the CI database on the runner reached 12,240 leaked
-- schemas by 2026-06-12, bloating the catalog and slowing every run.
--
-- Postgres does not record schema creation time, but the uuidv7 embedded in
-- the schema name does: its first 48 bits are a millisecond unix timestamp.
-- This block decodes that timestamp from the name and drops schemas older
-- than the cutoff. Names that do not end in a >= 20-char hex run decoding to
-- a plausible timestamp (2024-01-01 .. now + 1h) are never touched, which
-- protects public, pgtap, wt_* worktree schemas, langfuse, and anything else
-- hand-created. The 20-char minimum exists because the 63-char schema-name
-- truncation can shave the tail of the 32-char compact uuid.
--
-- Invoked by scripts/test/reset-test-db.sh (best-effort, non-fatal) with
-- __MAX_AGE_HOURS__ substituted; runnable standalone the same way:
--   sed "s/__MAX_AGE_HOURS__/24/" scripts/test/gc-test-schemas.sql \
--     | docker exec -i <postgres-container> psql -U postgres -d <db>

-- A procedure (not a DO block) so it can COMMIT every batch: DROP CASCADE
-- locks accumulate per transaction, and a single-transaction sweep over
-- thousands of leaked schemas exhausts max_locks_per_transaction ("out of
-- shared memory") partway through. Observed locally: 37k leaked schemas,
-- single transaction capped out after ~2.8k drops.
CREATE OR REPLACE PROCEDURE pg_temp.gc_test_schemas(max_age_hours numeric)
LANGUAGE plpgsql
AS $gc$
DECLARE
  schema_row record;
  hex_tail text;
  created_at_ms bigint;
  now_ms bigint := (extract(epoch FROM now()) * 1000)::bigint;
  cutoff_ms bigint;
  min_plausible_ms constant bigint := 1704067200000; -- 2024-01-01T00:00:00Z
  batch_size constant int := 50;
  scanned int := 0;
  dropped int := 0;
  skipped int := 0;
BEGIN
  cutoff_ms := now_ms - (max_age_hours * 3600 * 1000)::bigint;

  FOR schema_row IN
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\_%'
      AND nspname NOT IN ('public', 'information_schema', 'pgtap')
      AND nspname NOT LIKE 'wt\_%'
  LOOP
    scanned := scanned + 1;
    hex_tail := (regexp_match(schema_row.nspname, '([0-9a-f]{20,32})$'))[1];
    IF hex_tail IS NULL THEN
      CONTINUE;
    END IF;

    created_at_ms := ('x' || lpad(substring(hex_tail FROM 1 FOR 12), 16, '0'))::bit(64)::bigint;
    IF created_at_ms < min_plausible_ms OR created_at_ms > now_ms + 3600000 THEN
      CONTINUE;
    END IF;

    IF created_at_ms < cutoff_ms THEN
      -- Per-schema failure isolation: a schema still lock-held by a live
      -- run or with odd dependencies must not abort the whole sweep; skip
      -- it and let the next sweep retry.
      BEGIN
        PERFORM set_config('lock_timeout', '10s', true);
        EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_row.nspname);
        dropped := dropped + 1;
      EXCEPTION WHEN OTHERS THEN
        skipped := skipped + 1;
        RAISE NOTICE 'Schema GC: skipped % (%)', schema_row.nspname, SQLERRM;
      END;

      IF dropped % batch_size = 0 THEN
        COMMIT; -- release accumulated locks before the next batch
      END IF;
    END IF;
  END LOOP;

  COMMIT;
  RAISE NOTICE 'Schema GC: scanned %, dropped %, skipped %',
    scanned, dropped, skipped;
END
$gc$;

CALL pg_temp.gc_test_schemas(__MAX_AGE_HOURS__::numeric);
