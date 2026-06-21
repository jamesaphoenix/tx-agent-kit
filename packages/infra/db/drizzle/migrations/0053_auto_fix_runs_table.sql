-- Auto-fix runs table: tracks new-issue webhook triggers and the outcome of
-- agent execution. Operational infra (NOT a domain event): the API webhook
-- inserts a row on a genuinely new issue and starts a Temporal workflow
-- directly via the sanctioned adapter.
--
-- The unique index on sentry_issue_id is BOTH the once-per-issue guarantee and
-- the webhook dedupe key (INSERT ... ON CONFLICT (sentry_issue_id) DO NOTHING).
--
-- Agent-generic columns (no 'codex' in names) so the pluggable AgentRunner can be
-- codex or claude: agent (which runtime ran), agent_output (structured result),
-- agent_jsonl_output (raw JSONL/stream output for audit).
--
-- Objects are created per-schema (current_schema), NOT public.*, so CI's
-- parallel-per-schema integration suites never contend on the shared catalog
-- tuple. The enum creation is guarded with an IF-NOT-EXISTS check scoped to the
-- running schema so a re-apply (or a shared local DB already carrying the type
-- under a different migration filename) is idempotent rather than a hard error;
-- the table + indexes use plain IF NOT EXISTS.

-- Enums (mirrors @tx-agent-kit/contracts autoFixAgentKinds + autoFixRunStatuses)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'auto_fix_agent_kind'
       AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE auto_fix_agent_kind AS ENUM ('codex', 'claude');
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'auto_fix_run_status'
       AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE auto_fix_run_status AS ENUM (
      'pending',
      'dispatched',
      'running',
      'pr_opened',
      'pushed_no_pr',
      'blocked',
      'failed',
      'rate_limited',
      'skipped'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auto_fix_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sentry_issue_id TEXT NOT NULL,
  environment TEXT NOT NULL,              -- 'staging' | 'production'
  fingerprint TEXT,
  title TEXT NOT NULL,
  permalink TEXT,
  status auto_fix_run_status NOT NULL DEFAULT 'pending',
  branch TEXT,                            -- autofix/<sentry_issue_id>
  agent auto_fix_agent_kind,              -- 'codex' | 'claude' (null until the activity runs)
  agent_output JSONB,                     -- structured AutoFixResult
  agent_jsonl_output TEXT,                -- raw JSONL/stream output for audit
  pr_url TEXT,
  agent_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Once-per-issue dedupe key AND webhook dedupe detection.
CREATE UNIQUE INDEX IF NOT EXISTS auto_fix_runs_sentry_issue_unique
  ON auto_fix_runs (sentry_issue_id);

-- Query pending / recently-completed runs by status + creation time.
CREATE INDEX IF NOT EXISTS auto_fix_runs_status_idx
  ON auto_fix_runs (status, created_at);

-- Separate staging vs production runs operationally.
CREATE INDEX IF NOT EXISTS auto_fix_runs_environment_idx
  ON auto_fix_runs (environment);
