-- 0010_auth_email_and_session_hardening.sql
-- Adds case-insensitive/canonical email enforcement for users and
-- session invalidation support via password_changed_at.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

UPDATE users
SET email = lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_unique
  ON users (lower(trim(email)));

CREATE OR REPLACE FUNCTION normalize_user_email_fn()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS normalize_user_email ON users;

CREATE TRIGGER normalize_user_email
  BEFORE INSERT OR UPDATE OF email ON users
  FOR EACH ROW
  EXECUTE PROCEDURE normalize_user_email_fn();
