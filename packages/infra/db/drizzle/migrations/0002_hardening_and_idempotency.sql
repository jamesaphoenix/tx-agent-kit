ALTER TABLE IF EXISTS workspaces
  DROP CONSTRAINT IF EXISTS workspaces_owner_user_id_fkey;

ALTER TABLE IF EXISTS workspaces
  ADD CONSTRAINT workspaces_owner_user_id_fkey
  FOREIGN KEY (owner_user_id)
  REFERENCES users(id)
  ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS processed_operations (
  operation_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processed_operations_workspace_id_idx
ON processed_operations(workspace_id);
