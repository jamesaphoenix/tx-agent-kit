-- Lifecycle email engine: due-queue + state-reducer migration.
--
-- Replaces the per-enrollment Temporal drip workflow with a due-queue swept by a
-- pure state reducer. The enrollment row now carries the entire reduced drip
-- state (next_step_at + paused_remaining_secs), email_campaigns gets a stable
-- slug for config-as-code sync, and lifecycle_milestones makes "first time" /
-- "once per team" lifecycle events fire exactly once.

-- Config-as-code stable key (NULL = hand-created/unmanaged campaign).
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS email_campaigns_slug_unique
  ON email_campaigns (slug) WHERE slug IS NOT NULL;

-- Reduced drip state on the enrollment row (the only progression state).
ALTER TABLE email_campaign_enrollments ADD COLUMN IF NOT EXISTS next_step_at TIMESTAMPTZ;
ALTER TABLE email_campaign_enrollments ADD COLUMN IF NOT EXISTS paused_remaining_secs INTEGER;
ALTER TABLE email_campaign_enrollments ADD COLUMN IF NOT EXISTS sweep_leased_until TIMESTAMPTZ;

-- THE DUE QUEUE: only active + scheduled rows are indexed, so paused/terminal
-- and future-dated rows impose zero per-sweep cost. Claim cost is O(due rows).
CREATE INDEX IF NOT EXISTS idx_email_campaign_enrollments_due
  ON email_campaign_enrollments (next_step_at)
  WHERE status = 'active' AND next_step_at IS NOT NULL;

-- "Fires at most once" markers. feature_used inserts (user_id, milestone); the
-- activity scan inserts (team_id, milestone). Permanent (no retention).
CREATE TABLE IF NOT EXISTS lifecycle_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  milestone TEXT NOT NULL,
  reached_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_milestones_user_unique
  ON lifecycle_milestones (user_id, milestone) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_milestones_team_unique
  ON lifecycle_milestones (team_id, milestone) WHERE team_id IS NOT NULL;
