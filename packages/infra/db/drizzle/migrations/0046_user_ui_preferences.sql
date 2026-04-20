-- Persist per-user/per-organization UI dismissals for billing surfaces.
CREATE TABLE IF NOT EXISTS user_ui_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_ui_preferences_user_org_key_unique
  ON user_ui_preferences(user_id, organization_id, preference_key);

CREATE INDEX IF NOT EXISTS user_ui_preferences_org_user_idx
  ON user_ui_preferences(organization_id, user_id);
