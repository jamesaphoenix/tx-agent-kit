-- 0012_reinstate_invitation_identity_trigger.sql
-- Guarantees invitation email normalization + invitee binding trigger exists
-- even for databases that previously skipped or dropped this trigger.

CREATE OR REPLACE FUNCTION normalize_invitation_identity_fn()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));

  IF NEW.invitee_user_id IS NULL OR TG_OP = 'UPDATE' THEN
    SELECT users.id
    INTO NEW.invitee_user_id
    FROM users
    WHERE lower(users.email) = NEW.email
    ORDER BY users.created_at ASC
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS normalize_invitation_identity ON invitations;
DROP TRIGGER IF EXISTS trg_normalize_invitation_identity ON invitations;

CREATE TRIGGER normalize_invitation_identity
  BEFORE INSERT OR UPDATE OF email ON invitations
  FOR EACH ROW
  EXECUTE PROCEDURE normalize_invitation_identity_fn();
