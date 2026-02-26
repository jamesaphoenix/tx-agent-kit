-- 0018_auth_login_table_semantics.sql
-- Clarify that auth_login_* artifacts are strictly for first-party SaaS login/authentication.

BEGIN;

COMMENT ON TABLE auth_login_sessions IS
  'First-party SaaS login sessions. Used only for product authentication/session revocation.';

COMMENT ON TABLE auth_login_refresh_tokens IS
  'Refresh tokens for first-party SaaS login sessions. Not used for third-party account connection OAuth.';

COMMENT ON TABLE auth_login_oidc_states IS
  'Ephemeral OAuth/OIDC state+nonce+PKCE records for first-party SaaS login only.';

COMMENT ON TABLE auth_login_identities IS
  'External identity links used to authenticate into the SaaS product (login auth), not social account connections.';

COMMENT ON TABLE auth_login_audit_events IS
  'Audit trail for first-party authentication/login security events.';

COMMIT;
