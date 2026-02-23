CREATE INDEX IF NOT EXISTS workspace_members_user_id_idx
ON workspace_members (user_id);

CREATE INDEX IF NOT EXISTS invitations_invitee_user_created_at_id_idx
ON invitations (invitee_user_id, created_at, id);

CREATE INDEX IF NOT EXISTS invitations_invitee_user_expires_at_id_idx
ON invitations (invitee_user_id, expires_at, id);

CREATE INDEX IF NOT EXISTS tasks_workspace_created_at_id_idx
ON tasks (workspace_id, created_at, id);

CREATE INDEX IF NOT EXISTS tasks_workspace_title_id_idx
ON tasks (workspace_id, title, id);

CREATE INDEX IF NOT EXISTS tasks_workspace_status_id_idx
ON tasks (workspace_id, status, id);

CREATE INDEX IF NOT EXISTS tasks_workspace_created_by_user_id_idx
ON tasks (workspace_id, created_by_user_id);
