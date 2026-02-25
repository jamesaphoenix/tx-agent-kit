-- 0013_restore_public_invitation_identity_trigger.sql
-- Reinstates invitation identity normalization on the public schema even if
-- earlier migrations were applied with a non-public search_path.

CREATE OR REPLACE FUNCTION public.normalize_invitation_identity_fn()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));

  IF NEW.invitee_user_id IS NULL OR TG_OP = 'UPDATE' THEN
    SELECT users.id
    INTO NEW.invitee_user_id
    FROM public.users AS users
    WHERE lower(trim(users.email)) = NEW.email
    ORDER BY users.created_at ASC
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS normalize_invitation_identity ON public.invitations;
DROP TRIGGER IF EXISTS trg_normalize_invitation_identity ON public.invitations;

CREATE TRIGGER normalize_invitation_identity
  BEFORE INSERT OR UPDATE OF email ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_invitation_identity_fn();
