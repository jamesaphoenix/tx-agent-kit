ALTER TABLE IF EXISTS invitations
  ADD COLUMN IF NOT EXISTS invitee_user_id uuid;

ALTER TABLE IF EXISTS invitations
  DROP CONSTRAINT IF EXISTS invitations_invitee_user_id_fkey;

ALTER TABLE IF EXISTS invitations
  ADD CONSTRAINT invitations_invitee_user_id_fkey
  FOREIGN KEY (invitee_user_id)
  REFERENCES users(id)
  ON DELETE SET NULL;

UPDATE invitations
SET invitee_user_id = users.id
FROM users
WHERE invitations.invitee_user_id IS NULL
  AND lower(invitations.email) = lower(users.email);

CREATE INDEX IF NOT EXISTS invitations_invitee_user_id_idx
ON invitations(invitee_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS invitations_workspace_invitee_pending_unique
ON invitations(workspace_id, invitee_user_id)
WHERE status = 'pending' AND invitee_user_id IS NOT NULL;
