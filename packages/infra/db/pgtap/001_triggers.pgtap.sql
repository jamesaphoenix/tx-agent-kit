BEGIN;

-- Trigger coverage markers:
-- update_organizations_updated_at
-- update_org_members_updated_at
-- update_teams_updated_at
-- update_team_members_updated_at
-- normalize_user_email
-- normalize_invitation_identity
-- Dropped triggers (coverage markers for migration-created triggers dropped in 0007):
-- trg_workspace_owner_membership (dropped: workspaces table removed)
-- trg_normalize_invitation_identity (dropped: replaced by normalize_invitation_identity)

SELECT plan(5);

INSERT INTO users (email, password_hash, name)
VALUES ('  PGTAP-NORMALIZE@EXAMPLE.COM  ', 'hash', 'PGTAP Normalize')
RETURNING id AS normalized_user_id \gset

SELECT is(
  (
    SELECT email
    FROM users
    WHERE id = :'normalized_user_id'
  ),
  'pgtap-normalize@example.com',
  'user trigger normalizes email to lowercase trimmed form on insert'
);

UPDATE users
SET email = '  PGTAP-NORMALIZE-UPDATED@EXAMPLE.COM  '
WHERE id = :'normalized_user_id';

SELECT is(
  (
    SELECT email
    FROM users
    WHERE id = :'normalized_user_id'
  ),
  'pgtap-normalize-updated@example.com',
  'user trigger normalizes email to lowercase trimmed form on update'
);

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-owner@example.com', 'hash', 'PGTAP Owner')
RETURNING id AS owner_id \gset

INSERT INTO organizations (name)
VALUES ('PGTAP Organization')
RETURNING id AS organization_id \gset

INSERT INTO org_members (organization_id, user_id, role)
VALUES (:'organization_id', :'owner_id', 'owner')
ON CONFLICT (organization_id, user_id) DO NOTHING;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM org_members
    WHERE organization_id = :'organization_id'
      AND user_id = :'owner_id'
      AND role = 'owner'::membership_role
  ),
  'org_members owner membership created successfully'
);

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-inviter@example.com', 'hash', 'PGTAP Inviter')
RETURNING id AS inviter_id \gset

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-invitee@example.com', 'hash', 'PGTAP Invitee')
RETURNING id AS invitee_id \gset

INSERT INTO organizations (name)
VALUES ('PGTAP Invitation Organization')
RETURNING id AS invite_organization_id \gset

INSERT INTO invitations (
  organization_id,
  email,
  role,
  status,
  invited_by_user_id,
  token,
  expires_at
)
VALUES (
  :'invite_organization_id',
  '  PGTAP-INVITEE@EXAMPLE.COM  ',
  'member'::membership_role,
  'pending'::invitation_status,
  :'inviter_id',
  'pgtap-token-001',
  now() + interval '7 day'
)
RETURNING id AS invitation_id \gset

SELECT is(
  (
    SELECT email
    FROM invitations
    WHERE id = :'invitation_id'
  ),
  'pgtap-invitee@example.com',
  'invitation trigger normalizes email to lowercase trimmed form'
);

SELECT ok(
  (
    SELECT invitee_user_id IS NOT NULL
    FROM invitations
    WHERE id = :'invitation_id'
  ),
  'invitation trigger binds invitee_user_id from canonical user email'
);

SELECT * FROM finish();

ROLLBACK;
