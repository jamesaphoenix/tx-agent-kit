-- Migration: invitation revocation audit + direct-to-team invitations
-- Adds: revoked_at, revoked_by_user_id, team_id to invitations table

-- 1. Add revoked_at for revocation timestamp audit trail
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- 2. Add revoked_by_user_id for revocation actor audit trail
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS revoked_by_user_id UUID REFERENCES users(id);

-- 3. Add team_id for direct-to-team invitations
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

-- 4. Partial index on team_id for efficient team-scoped queries
CREATE INDEX IF NOT EXISTS idx_invitations_team_id
  ON invitations(team_id)
  WHERE team_id IS NOT NULL;
