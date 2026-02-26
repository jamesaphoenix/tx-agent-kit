-- 0019_auth_login_oidc_column_semantics.sql
-- Strengthen semantic clarity that auth_login_oidc_states is strictly for SaaS login auth.

BEGIN;

COMMENT ON COLUMN auth_login_oidc_states.state IS
  'OIDC authorization state for first-party SaaS login flow only.';

COMMENT ON COLUMN auth_login_oidc_states.nonce IS
  'OIDC nonce bound to first-party SaaS login ID token validation.';

COMMENT ON COLUMN auth_login_oidc_states.code_verifier IS
  'PKCE code verifier used to complete first-party SaaS login OIDC callback.';

COMMENT ON COLUMN auth_login_oidc_states.redirect_uri IS
  'First-party SaaS login callback URI registered for authentication.';

COMMENT ON COLUMN auth_login_oidc_states.requester_ip IS
  'Client IP that initiated first-party SaaS login OIDC authorization.';

COMMENT ON COLUMN auth_login_oidc_states.consumed_at IS
  'Timestamp when the first-party SaaS login OIDC state was consumed (single-use).';

COMMIT;
