-- Allow one pending invitation per organization/email/workspace while preserving
-- one pending org-wide invitation per organization/email.
DROP INDEX IF EXISTS invitations_org_email_pending_unique;

CREATE UNIQUE INDEX IF NOT EXISTS invitations_org_email_orgwide_pending_unique
  ON invitations(organization_id, email)
  WHERE status = 'pending' AND team_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invitations_org_email_team_pending_unique
  ON invitations(organization_id, email, team_id)
  WHERE status = 'pending' AND team_id IS NOT NULL;
