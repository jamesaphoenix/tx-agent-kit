CREATE TYPE domain_event_status AS ENUM ('pending', 'processing', 'published', 'failed');

CREATE TABLE IF NOT EXISTS domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid,
  sequence_number integer NOT NULL DEFAULT 1,
  status domain_event_status NOT NULL DEFAULT 'pending',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS domain_events_pending_poller_idx
  ON domain_events (status, occurred_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS domain_events_aggregate_stream_idx
  ON domain_events (aggregate_type, aggregate_id);

CREATE INDEX IF NOT EXISTS domain_events_event_type_occurred_at_idx
  ON domain_events (event_type, occurred_at);

CREATE UNIQUE INDEX IF NOT EXISTS domain_events_aggregate_sequence_unique
  ON domain_events (aggregate_id, sequence_number);
