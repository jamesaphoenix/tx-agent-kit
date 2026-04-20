-- Migration: tenancy model spec gaps
-- Adds: owner_user_id, disabled_at on memberships, content_review_tokens, roles.is_system

-- 1. Add owner_user_id to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id);

-- Backfill: set owner_user_id from the first 'owner' role org_member for each org
UPDATE organizations o
SET owner_user_id = (
  SELECT om.user_id
  FROM org_members om
  WHERE om.organization_id = o.id AND om.role = 'owner'
  ORDER BY om.created_at ASC
  LIMIT 1
)
WHERE o.owner_user_id IS NULL;

-- Make NOT NULL after backfill (only if all rows have been populated)
-- ALTER TABLE organizations ALTER COLUMN owner_user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS organizations_owner_user_id_idx
  ON organizations(owner_user_id);

-- 2. Add disabled_at to org_members
ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

CREATE INDEX IF NOT EXISTS org_members_disabled_at_idx
  ON org_members(disabled_at)
  WHERE disabled_at IS NOT NULL;

-- 3. Add disabled_at to team_members
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

CREATE INDEX IF NOT EXISTS team_members_disabled_at_idx
  ON team_members(disabled_at)
  WHERE disabled_at IS NOT NULL;

-- 4. Add is_system to roles (seeded roles are immutable)
ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- Mark existing seeded roles as system roles
UPDATE roles SET is_system = true
WHERE name IN ('owner', 'admin', 'member', 'creator', 'viewer');

-- 5. Create content_review_tokens table
CREATE TABLE IF NOT EXISTS content_review_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  permissions text[] NOT NULL DEFAULT '{"view"}',
  reviewer_name text,
  reviewer_email text,
  last_accessed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_review_tokens_team_id_idx
  ON content_review_tokens(team_id);

CREATE INDEX IF NOT EXISTS content_review_tokens_expires_at_idx
  ON content_review_tokens(expires_at)
  WHERE revoked_at IS NULL;

-- 6. Add usage_cap to organizations (plan-enforced spending cap)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS usage_cap bigint;
