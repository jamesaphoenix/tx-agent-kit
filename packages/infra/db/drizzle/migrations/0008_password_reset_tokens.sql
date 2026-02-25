-- 0008_password_reset_tokens.sql
-- Adds one-time password reset token storage for forgot-password flows.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '30 minutes'),
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_at_idx
  ON password_reset_tokens(user_id, created_at);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
  ON password_reset_tokens(expires_at);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_expires_at_active_idx
  ON password_reset_tokens(user_id, expires_at)
  WHERE used_at IS NULL;
