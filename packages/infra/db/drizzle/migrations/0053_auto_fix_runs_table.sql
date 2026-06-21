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
-- Plain CREATE TYPE / CREATE TABLE so the objects land in the running schema
-- (current_schema), NOT public.* -- the integration suites run one isolated
-- schema per worker, and CREATE OR REPLACE public.* would contend on the shared
-- catalog tuple and deadlock the parallel-per-schema runs.

-- Enums (mirrors @tx-agent-kit/contracts autoFixAgentKinds + autoFixRunStatuses)
CREATE TYPE auto_fix_agent_kind AS ENUM ('codex', 'claude');
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

CREATE TABLE auto_fix_runs (
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
CREATE UNIQUE INDEX auto_fix_runs_sentry_issue_unique
  ON auto_fix_runs (sentry_issue_id);

-- Query pending / recently-completed runs by status + creation time.
CREATE INDEX auto_fix_runs_status_idx
  ON auto_fix_runs (status, created_at);

-- Separate staging vs production runs operationally.
CREATE INDEX auto_fix_runs_environment_idx
  ON auto_fix_runs (environment);
