-- 0014_ensure_invitation_identity_trigger_all_schemas.sql
-- Ensures invitation identity normalization trigger exists for both the
-- current schema and public schema (when tables exist in each).

DO $$
DECLARE
  target_schema text;
BEGIN
  FOR target_schema IN
    SELECT DISTINCT schema_name
    FROM (
      VALUES (current_schema()), ('public')
    ) AS candidate_schemas(schema_name)
  LOOP
    IF to_regclass(format('%I.users', target_schema)) IS NULL
      OR to_regclass(format('%I.invitations', target_schema)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      $function$
      CREATE OR REPLACE FUNCTION %1$I.normalize_invitation_identity_fn()
      RETURNS TRIGGER AS $body$
      BEGIN
        NEW.email := lower(trim(NEW.email));

        IF NEW.invitee_user_id IS NULL OR TG_OP = 'UPDATE' THEN
          SELECT users.id
          INTO NEW.invitee_user_id
          FROM %1$I.users AS users
          WHERE lower(trim(users.email)) = NEW.email
          ORDER BY users.created_at ASC
          LIMIT 1;
        END IF;

        RETURN NEW;
      END;
      $body$ LANGUAGE plpgsql;
      $function$,
      target_schema
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS normalize_invitation_identity ON %I.invitations',
      target_schema
    );
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_normalize_invitation_identity ON %I.invitations',
      target_schema
    );

    EXECUTE format(
      'CREATE TRIGGER normalize_invitation_identity BEFORE INSERT OR UPDATE OF email ON %1$I.invitations FOR EACH ROW EXECUTE FUNCTION %1$I.normalize_invitation_identity_fn()',
      target_schema
    );
  END LOOP;
END;
$$;
