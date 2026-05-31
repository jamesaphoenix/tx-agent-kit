BEGIN;

-- Trigger coverage markers:
-- domain_events_notify_insert (outbox NOTIFY doorbell, migration 0050)
-- Function coverage markers:
-- notify_outbox_new_event

SELECT plan(2);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE p.proname = 'notify_outbox_new_event'
      AND n.nspname = current_schema()
  ),
  'notify_outbox_new_event function exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    JOIN pg_class AS r ON r.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = r.relnamespace
    WHERE t.tgname = 'domain_events_notify_insert'
      AND r.relname = 'domain_events'
      AND n.nspname = current_schema()
      AND t.tgisinternal = false
  ),
  'domain_events insert NOTIFY trigger exists'
);

SELECT * FROM finish();

ROLLBACK;
