-- Fix: Pending poller index — add id tiebreaker so ORDER BY occurred_at ASC, id ASC
-- uses the index without a separate Sort node
DROP INDEX IF EXISTS domain_events_pending_poller_idx;
CREATE INDEX domain_events_pending_poller_idx
  ON domain_events (occurred_at ASC, id ASC)
  WHERE status = 'pending';

-- Fix: Stuck processing index — drop redundant status from key (partial predicate handles it),
-- lead with processing_at for efficient range scans
DROP INDEX IF EXISTS domain_events_stuck_processing_idx;
CREATE INDEX domain_events_stuck_processing_idx
  ON domain_events (processing_at ASC)
  WHERE status = 'processing';

-- New: Prune index for published/failed events — supports retention DELETE queries
-- Uses published_at for published events and failed_at for failed events
CREATE INDEX domain_events_prune_published_idx
  ON domain_events (published_at ASC)
  WHERE status = 'published';

CREATE INDEX domain_events_prune_failed_idx
  ON domain_events (failed_at ASC)
  WHERE status = 'failed';

-- Drop: event_type + occurred_at index — never queried by any repository or testkit code,
-- adds write amplification with zero read benefit
DROP INDEX IF EXISTS domain_events_event_type_occurred_at_idx;
