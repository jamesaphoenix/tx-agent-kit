CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value, description)
VALUES (
  'retention_settings',
  '{
    "auth_login_sessions": { "enabled": true, "retention_days": 90 },
    "auth_refresh_tokens": { "enabled": true, "retention_days": 90 },
    "auth_oidc_states": { "enabled": true, "retention_days": 7 },
    "auth_password_reset_tokens": { "enabled": true, "retention_days": 30 },
    "auth_login_audit_events": { "enabled": true, "retention_days": 365 },
    "subscription_events": { "enabled": true, "retention_days": 90 },
    "domain_events": { "enabled": true, "retention_days": 30 },
    "invitations": { "enabled": true, "retention_days": 180 }
  }',
  'Retention policies for automated data pruning. Tables not listed (usage_records, credit_ledger) are financial audit trails and must never be pruned.'
)
ON CONFLICT (key) DO NOTHING;
