-- Generated from packages/infra/db/src/system-settings-defaults.ts.
-- Update defaultRetentionSettings and regenerate when defaults change.

INSERT INTO system_settings (key, value, description)
VALUES (
  'retention_settings',
  '{
  "auth_login_sessions": {
    "enabled": true,
    "retention_days": 90
  },
  "auth_login_refresh_tokens": {
    "enabled": true,
    "retention_days": 90
  },
  "auth_login_oidc_states": {
    "enabled": true,
    "retention_days": 7
  },
  "password_reset_tokens": {
    "enabled": true,
    "retention_days": 30
  },
  "auth_login_audit_events": {
    "enabled": true,
    "retention_days": 365
  },
  "subscription_events": {
    "enabled": true,
    "retention_days": 90
  },
  "domain_events": {
    "enabled": true,
    "retention_days": 30
  },
  "invitations": {
    "enabled": true,
    "retention_days": 180
  }
}'::jsonb,
  'Retention policies for automated data pruning. Tables not listed (usage_records, credit_ledger) are financial audit trails and must never be pruned.'
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();
