CREATE OR REPLACE FUNCTION ensure_workspace_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE workspace_members
  SET role = 'admin'
  WHERE workspace_id = NEW.id
    AND role = 'owner'
    AND user_id <> NEW.owner_user_id;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_owner_membership ON workspaces;

CREATE TRIGGER trg_workspace_owner_membership
AFTER INSERT OR UPDATE OF owner_user_id ON workspaces
FOR EACH ROW
EXECUTE FUNCTION ensure_workspace_owner_membership();

CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_single_owner_idx
ON workspace_members (workspace_id)
WHERE role = 'owner';

CREATE OR REPLACE FUNCTION normalize_invitation_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));

  SELECT users.id
  INTO NEW.invitee_user_id
  FROM users
  WHERE lower(users.email) = NEW.email
  ORDER BY users.created_at ASC
  LIMIT 1;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_invitation_identity ON invitations;

CREATE TRIGGER trg_normalize_invitation_identity
BEFORE INSERT OR UPDATE OF email ON invitations
FOR EACH ROW
EXECUTE FUNCTION normalize_invitation_identity();
