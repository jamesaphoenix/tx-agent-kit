-- 0020_auth_login_enum_semantics.sql
-- Clarify enum semantics for first-party login/auth-specific OAuth state and session records.

BEGIN;

COMMENT ON TYPE auth_login_provider IS
  'Identity provider enum used exclusively for first-party SaaS authentication/login flows.';

COMMENT ON TYPE auth_login_audit_status IS
  'Audit status values for first-party authentication/login security events.';

COMMENT ON TYPE auth_login_audit_event_type IS
  'Audit event enum for first-party authentication/login lifecycle events.';

COMMENT ON COLUMN auth_login_sessions.provider IS
  'Provider used to establish first-party SaaS login session.';

COMMENT ON COLUMN auth_login_identities.provider IS
  'Provider identity linked for first-party SaaS login authentication.';

COMMENT ON COLUMN auth_login_audit_events.event_type IS
  'First-party SaaS authentication/login event category.';

COMMIT;
