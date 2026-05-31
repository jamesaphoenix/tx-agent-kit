-- Outbox NOTIFY doorbell.
--
-- Wakes the worker's LISTEN-based dispatcher the moment a domain event lands so
-- it no longer needs to poll every 5s (a per-tick Temporal-Action cost paid even
-- when the outbox is empty). The payload is intentionally empty: the
-- `domain_events` table remains the source of truth and the listener drains it
-- with `FOR UPDATE SKIP LOCKED`. Statement-level so a bulk insert fires one
-- notification rather than one per row. Postgres delivers notifications at
-- COMMIT, so listeners never wake on uncommitted rows.
--
-- Rollback: DROP TRIGGER domain_events_notify_insert ON domain_events;
--           DROP FUNCTION notify_outbox_new_event();
CREATE OR REPLACE FUNCTION notify_outbox_new_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('outbox_new_event', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS domain_events_notify_insert ON domain_events;

CREATE TRIGGER domain_events_notify_insert
AFTER INSERT ON domain_events
FOR EACH STATEMENT
EXECUTE FUNCTION notify_outbox_new_event();
