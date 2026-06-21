-- Security hardening (defense in depth): revoke the managed-Postgres data API
-- roles' access to everything in `public`.
--
-- This app talks to Postgres directly through the connection pooler as the
-- `postgres` owner role. It never uses a PostgREST-style data API. On a managed
-- Supabase-style project, though, the `anon` and `authenticated` roles are
-- granted full DML on every `public` table by default, and our tables run with
-- RLS disabled. That means the only thing standing between sensitive tables
-- (users, sessions, ...) and the public internet is that the data API happens to
-- be disabled. A single dashboard toggle would turn a cosmetic setting into a
-- full unauthenticated read/write breach.
--
-- This removes that single point of failure: strip the existing grants from
-- `anon`/`authenticated` on all current `public` objects, and stop the default
-- privileges from re-granting them on future objects the `postgres` role creates
-- (i.e. every later migration). The `postgres` owner is unaffected - owners keep
-- full access regardless of grants - so the app keeps working.
--
-- Guarded by a role-existence check: local dev and CI run on plain Postgres,
-- which has no `anon`/`authenticated` roles, so the block is a no-op there.
-- The whole statement is idempotent and safe to re-run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
  THEN
    -- Existing objects in `public`.
    REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

    -- Future objects created by the app's owner role (`postgres`). Without this,
    -- the next migration that creates a table would silently re-expose it.
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END
$$;
