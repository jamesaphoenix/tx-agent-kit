-- 0007_org_hierarchy_and_task_removal.sql
-- Introduces organization hierarchy (org_members, teams, team_members),
-- expands organizations with billing/subscription columns,
-- migrates workspace data into organizations, rewires FKs,
-- and drops task-related and workspace tables.

-- ── 3a. Create new enums ───────────────────────────────────────────────
CREATE TYPE subscription_status AS ENUM ('active', 'inactive', 'trialing', 'past_due', 'canceled', 'paused', 'unpaid');
CREATE TYPE membership_type AS ENUM ('team', 'client');

-- ── 3b. Expand organizations table ────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN billing_email TEXT,
  ADD COLUMN onboarding_data JSONB,
  ADD COLUMN stripe_customer_id TEXT,
  ADD COLUMN stripe_subscription_id TEXT,
  ADD COLUMN stripe_payment_method_id TEXT,
  ADD COLUMN credits_balance BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN reserved_credits BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN auto_recharge_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN auto_recharge_threshold BIGINT,
  ADD COLUMN auto_recharge_amount BIGINT,
  ADD COLUMN is_subscribed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN subscription_status subscription_status NOT NULL DEFAULT 'inactive',
  ADD COLUMN subscription_plan TEXT,
  ADD COLUMN subscription_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN subscription_ends_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN subscription_current_period_end TIMESTAMP WITH TIME ZONE,
  ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

-- ── 3c. Create updated_at trigger function and trigger ─────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();

-- ── 3d. Migrate workspace data into organizations ──────────────────────
INSERT INTO organizations (id, name, created_at)
  SELECT id, name, created_at FROM workspaces
  ON CONFLICT (id) DO NOTHING;

-- ── 3e. Create org_members table ───────────────────────────────────────
CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id),
  role membership_role NOT NULL DEFAULT 'member',
  membership_type membership_type NOT NULL DEFAULT 'team',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX org_members_org_id_idx ON org_members(organization_id);
CREATE INDEX org_members_user_id_idx ON org_members(user_id);
CREATE INDEX org_members_role_id_idx ON org_members(role_id);

CREATE TRIGGER update_org_members_updated_at
  BEFORE UPDATE ON org_members
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();

-- ── 3f. Migrate workspace_members + workspace owners to org_members ────
-- Migrate workspace owners
INSERT INTO org_members (organization_id, user_id, role, membership_type)
  SELECT w.id, w.owner_user_id, 'owner', 'team'
  FROM workspaces w
  WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.id = w.id)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Migrate workspace members
INSERT INTO org_members (organization_id, user_id, role, membership_type)
  SELECT wm.workspace_id, wm.user_id, wm.role, 'team'
  FROM workspace_members wm
  WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.id = wm.workspace_id)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

-- ── 3g. Create teams table ─────────────────────────────────────────────
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website TEXT,
  brand_settings JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX teams_org_id_idx ON teams(organization_id);

CREATE TRIGGER update_teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();

-- ── 3h. Create team_members table ──────────────────────────────────────
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

CREATE INDEX team_members_team_id_idx ON team_members(team_id);
CREATE INDEX team_members_user_id_idx ON team_members(user_id);
CREATE INDEX team_members_role_id_idx ON team_members(role_id);

CREATE TRIGGER update_team_members_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();

-- ── 3i. Rewire invitations FK ──────────────────────────────────────────
ALTER TABLE invitations ADD COLUMN organization_id UUID;

UPDATE invitations SET organization_id = workspace_id
  WHERE workspace_id IS NOT NULL;

ALTER TABLE invitations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE invitations ADD CONSTRAINT invitations_organization_id_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Drop old index and create new one
DROP INDEX IF EXISTS invitations_workspace_email_pending_unique;
CREATE UNIQUE INDEX invitations_org_email_pending_unique
  ON invitations(organization_id, email) WHERE status = 'pending';

ALTER TABLE invitations DROP COLUMN workspace_id;

-- ── 3j. Rewire credit_ledger FK ───────────────────────────────────────
ALTER TABLE credit_ledger ADD COLUMN organization_id UUID;

UPDATE credit_ledger SET organization_id = workspace_id
  WHERE workspace_id IS NOT NULL;

ALTER TABLE credit_ledger ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_organization_id_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE credit_ledger DROP COLUMN workspace_id;

-- ── 3k. Drop task-related tables ──────────────────────────────────────
DROP TABLE IF EXISTS processed_operations;
DROP TABLE IF EXISTS tasks;
DROP TYPE IF EXISTS task_status;

-- ── 3l. Drop old triggers and workspace tables ────────────────────────
DROP TRIGGER IF EXISTS ensure_workspace_owner_membership ON workspaces;
DROP FUNCTION IF EXISTS ensure_workspace_owner_membership_fn() CASCADE;
DROP TRIGGER IF EXISTS trg_workspace_owner_membership ON workspaces;
DROP FUNCTION IF EXISTS trg_workspace_owner_membership_fn() CASCADE;
DROP FUNCTION IF EXISTS ensure_workspace_owner_membership() CASCADE;
DROP TRIGGER IF EXISTS trg_normalize_invitation_identity ON invitations;
DROP TRIGGER IF EXISTS normalize_invitation_identity ON invitations;
DROP FUNCTION IF EXISTS normalize_invitation_identity_fn() CASCADE;
DROP FUNCTION IF EXISTS normalize_invitation_identity() CASCADE;

DROP TABLE IF EXISTS workspace_members;
DROP TABLE IF EXISTS workspaces;

-- ── 3n. Create invitation identity normalization trigger ──────────────
CREATE OR REPLACE FUNCTION normalize_invitation_identity_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invitee_user_id IS NULL THEN
    NEW.invitee_user_id := (
      SELECT id FROM users WHERE email = lower(trim(NEW.email)) LIMIT 1
    );
  END IF;
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER normalize_invitation_identity
  BEFORE INSERT ON invitations
  FOR EACH ROW
  EXECUTE PROCEDURE normalize_invitation_identity_fn();
