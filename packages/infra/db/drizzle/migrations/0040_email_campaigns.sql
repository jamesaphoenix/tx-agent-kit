-- Email campaigns enums
CREATE TYPE email_campaign_type AS ENUM ('drip_sequence', 'broadcast');
CREATE TYPE email_campaign_status AS ENUM ('draft', 'active', 'paused', 'archived');
CREATE TYPE email_enrollment_status AS ENUM ('active', 'paused', 'completed', 'cancelled', 'failed');
CREATE TYPE email_send_status AS ENUM ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed');
CREATE TYPE email_suppression_reason AS ENUM ('hard_bounce', 'complaint', 'manual_unsubscribe');
CREATE TYPE email_cancel_reason AS ENUM ('user_unsubscribed', 'admin_cancelled', 'suppressed', 'campaign_archived');
CREATE TYPE email_source_system AS ENUM ('campaigns', 'notifications', 'admin');

-- email_campaigns
CREATE TABLE email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  campaign_type email_campaign_type NOT NULL,
  status email_campaign_status NOT NULL DEFAULT 'draft',
  trigger_config JSONB,
  audience_filter JSONB,
  from_name TEXT,
  reply_to TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_campaigns_status ON email_campaigns(status, created_at DESC);
CREATE INDEX idx_email_campaigns_type ON email_campaigns(campaign_type);
CREATE INDEX idx_email_campaigns_trigger ON email_campaigns
  USING gin(trigger_config) WHERE status = 'active';

-- email_campaign_steps
CREATE TABLE email_campaign_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  subject TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_data JSONB NOT NULL DEFAULT '{}',
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, step_order)
);

CREATE INDEX idx_email_campaign_steps_campaign ON email_campaign_steps(campaign_id, step_order);

-- email_campaign_enrollments
CREATE TABLE email_campaign_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status email_enrollment_status NOT NULL DEFAULT 'active',
  current_step_order INTEGER,
  temporal_workflow_id TEXT,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason email_cancel_reason,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id)
);

CREATE INDEX idx_email_campaign_enrollments_campaign ON email_campaign_enrollments(campaign_id, status);
CREATE INDEX idx_email_campaign_enrollments_user ON email_campaign_enrollments(user_id, status);
CREATE INDEX idx_email_campaign_enrollments_status ON email_campaign_enrollments(status, enrolled_at);

-- email_sends
CREATE TABLE email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID REFERENCES email_campaign_enrollments(id) ON DELETE SET NULL,
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES email_campaign_steps(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  resend_message_id TEXT,
  status email_send_status NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  complained_at TIMESTAMPTZ,
  failed_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_sends_resend_msg ON email_sends(resend_message_id)
  WHERE resend_message_id IS NOT NULL;
CREATE INDEX idx_email_sends_campaign_step ON email_sends(campaign_id, step_id, status);
CREATE INDEX idx_email_sends_user ON email_sends(user_id, created_at DESC);
CREATE INDEX idx_email_sends_enrollment_step ON email_sends(enrollment_id, step_id);
CREATE INDEX idx_email_sends_prune ON email_sends(created_at)
  WHERE status IN ('delivered', 'opened', 'clicked');

-- email_suppression_list
CREATE TABLE email_suppression_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  reason email_suppression_reason NOT NULL,
  source_system email_source_system NOT NULL,
  source_id TEXT,
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lifted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_email_suppression_active
  ON email_suppression_list(lower(email))
  WHERE lifted_at IS NULL;
CREATE INDEX idx_email_suppression_email
  ON email_suppression_list(lower(email));

-- email_unsubscribes
CREATE TABLE email_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX email_unsubscribes_user_campaign_unique
  ON email_unsubscribes(user_id, campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX email_unsubscribes_user_global_unique
  ON email_unsubscribes(user_id)
  WHERE campaign_id IS NULL;
CREATE INDEX idx_email_unsubscribes_user ON email_unsubscribes(user_id);
