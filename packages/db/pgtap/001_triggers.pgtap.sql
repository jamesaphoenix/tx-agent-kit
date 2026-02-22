BEGIN;

-- Trigger coverage markers:
-- trg_workspace_owner_membership
-- trg_normalize_invitation_identity

SELECT plan(5);

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-owner@example.com', 'hash', 'PGTAP Owner')
RETURNING id AS owner_id \gset

INSERT INTO workspaces (name, owner_user_id)
VALUES ('PGTAP Workspace', :'owner_id')
RETURNING id AS workspace_id \gset

SELECT ok(
  EXISTS (
    SELECT 1
    FROM workspace_members
    WHERE workspace_id = :'workspace_id'
      AND user_id = :'owner_id'
      AND role = 'owner'::membership_role
  ),
  'workspace trigger auto-creates owner membership'
);

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-first-owner@example.com', 'hash', 'PGTAP First Owner')
RETURNING id AS first_owner_id \gset

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-second-owner@example.com', 'hash', 'PGTAP Second Owner')
RETURNING id AS second_owner_id \gset

INSERT INTO workspaces (name, owner_user_id)
VALUES ('PGTAP Ownership Transfer', :'first_owner_id')
RETURNING id AS transfer_workspace_id \gset

UPDATE workspaces
SET owner_user_id = :'second_owner_id'
WHERE id = :'transfer_workspace_id';

SELECT is(
  (
    SELECT role::text
    FROM workspace_members
    WHERE workspace_id = :'transfer_workspace_id'
      AND user_id = :'second_owner_id'
  ),
  'owner',
  'ownership transfer promotes new owner role'
);

SELECT is(
  (
    SELECT role::text
    FROM workspace_members
    WHERE workspace_id = :'transfer_workspace_id'
      AND user_id = :'first_owner_id'
  ),
  'admin',
  'ownership transfer demotes prior owner to admin'
);

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-inviter@example.com', 'hash', 'PGTAP Inviter')
RETURNING id AS inviter_id \gset

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-invitee@example.com', 'hash', 'PGTAP Invitee')
RETURNING id AS invitee_id \gset

INSERT INTO workspaces (name, owner_user_id)
VALUES ('PGTAP Invitation Workspace', :'inviter_id')
RETURNING id AS invite_workspace_id \gset

INSERT INTO invitations (
  workspace_id,
  email,
  role,
  status,
  invited_by_user_id,
  token,
  expires_at
)
VALUES (
  :'invite_workspace_id',
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
