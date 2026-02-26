-- 0017_auth_login_session_and_oidc.sql
-- Adds explicit auth-login session, refresh token, OIDC state, identity, and audit tables.

DO $$
BEGIN
  CREATE TYPE auth_login_provider AS ENUM ('password', 'google');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE auth_login_audit_status AS ENUM ('success', 'failure');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE auth_login_audit_event_type AS ENUM (
    'login_success',
    'login_failure',
    'password_reset_requested',
    'password_changed',
    'oauth_linked',
    'oauth_unlinked',
    'session_refreshed',
    'session_revoked'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS auth_login_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider auth_login_provider NOT NULL DEFAULT 'password',
  created_ip TEXT,
  created_user_agent TEXT,
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_sessions_user_created_at_idx
  ON auth_login_sessions(user_id, created_at);

CREATE INDEX IF NOT EXISTS auth_login_sessions_user_expires_at_idx
  ON auth_login_sessions(user_id, expires_at);

CREATE INDEX IF NOT EXISTS auth_login_sessions_user_expires_at_active_idx
  ON auth_login_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_login_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES auth_login_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '30 days'),
  used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_refresh_tokens_session_created_at_idx
  ON auth_login_refresh_tokens(session_id, created_at);

CREATE INDEX IF NOT EXISTS auth_login_refresh_tokens_expires_at_idx
  ON auth_login_refresh_tokens(expires_at);

CREATE INDEX IF NOT EXISTS auth_login_refresh_tokens_session_expires_at_active_idx
  ON auth_login_refresh_tokens(session_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_login_oidc_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider auth_login_provider NOT NULL DEFAULT 'google',
  state TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  requester_ip TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_oidc_states_provider_expires_at_idx
  ON auth_login_oidc_states(provider, expires_at);

CREATE INDEX IF NOT EXISTS auth_login_oidc_states_expires_at_active_idx
  ON auth_login_oidc_states(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_login_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider auth_login_provider NOT NULL DEFAULT 'google',
  provider_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT auth_login_identities_provider_subject_unique UNIQUE (provider, provider_subject),
  CONSTRAINT auth_login_identities_user_provider_unique UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS auth_login_identities_user_provider_idx
  ON auth_login_identities(user_id, provider);

CREATE INDEX IF NOT EXISTS auth_login_identities_email_ci_idx
  ON auth_login_identities(lower(trim(email)));

CREATE TABLE IF NOT EXISTS auth_login_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type auth_login_audit_event_type NOT NULL,
  status auth_login_audit_status NOT NULL,
  identifier TEXT,
  ip_address TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_audit_events_user_created_at_idx
  ON auth_login_audit_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS auth_login_audit_events_event_type_created_at_idx
  ON auth_login_audit_events(event_type, created_at);
