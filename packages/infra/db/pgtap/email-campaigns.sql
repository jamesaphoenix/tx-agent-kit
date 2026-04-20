BEGIN;

SELECT plan(11);

-- ============================================================
-- Setup: create a user and an email campaign for FK references
-- ============================================================

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-email-campaigns@example.com', 'hash', 'PGTAP Email User')
RETURNING id AS test_user_id \gset

INSERT INTO users (email, password_hash, name)
VALUES ('pgtap-email-campaigns-2@example.com', 'hash', 'PGTAP Email User 2')
RETURNING id AS test_user_id_2 \gset

INSERT INTO email_campaigns (name, campaign_type, status, trigger_config)
VALUES (
  'PGTAP Test Campaign',
  'drip_sequence',
  'active',
  '{"type": "domain_event", "eventType": "organization.created"}'::jsonb
)
RETURNING id AS campaign_id \gset

-- ============================================================
-- 1. email_campaign_enrollments UNIQUE(campaign_id, user_id)
-- ============================================================

INSERT INTO email_campaign_enrollments (campaign_id, user_id, status)
VALUES (:'campaign_id', :'test_user_id', 'active');

SELECT throws_ok(
  format(
    $$INSERT INTO email_campaign_enrollments (campaign_id, user_id, status)
      VALUES ('%s', '%s', 'active')$$,
    :'campaign_id', :'test_user_id'
  ),
  '23505',
  NULL,
  'enrollment UNIQUE(campaign_id, user_id) rejects duplicate'
);

-- ============================================================
-- 2. email_campaign_steps UNIQUE(campaign_id, step_order)
-- ============================================================

INSERT INTO email_campaign_steps (campaign_id, step_order, subject, template_id, delay_seconds)
VALUES (:'campaign_id', 1, 'Welcome', 'onboarding/welcome', 0)
RETURNING id AS step_1_id \gset

SELECT throws_ok(
  format(
    $$INSERT INTO email_campaign_steps (campaign_id, step_order, subject, template_id, delay_seconds)
      VALUES ('%s', 1, 'Duplicate Step', 'onboarding/dup', 0)$$,
    :'campaign_id'
  ),
  '23505',
  NULL,
  'step UNIQUE(campaign_id, step_order) rejects duplicate'
);

-- ============================================================
-- 3. email_suppression_list partial unique index on
--    lower(email) WHERE lifted_at IS NULL
-- ============================================================

INSERT INTO email_suppression_list (email, reason, source_system)
VALUES ('SUPPRESSED@example.com', 'hard_bounce', 'campaigns');

SELECT throws_ok(
  $$INSERT INTO email_suppression_list (email, reason, source_system)
    VALUES ('suppressed@example.com', 'complaint', 'notifications')$$,
  '23505',
  NULL,
  'suppression partial unique rejects duplicate active suppression (case-insensitive)'
);

-- A lifted suppression should NOT conflict
INSERT INTO email_suppression_list (email, reason, source_system, lifted_at)
VALUES ('lifted@example.com', 'hard_bounce', 'campaigns', now());

SELECT ok(
  EXISTS (
    SELECT 1 FROM email_suppression_list WHERE email = 'lifted@example.com' AND lifted_at IS NOT NULL
  ),
  'lifted suppression allows a new active suppression for the same email'
);

INSERT INTO email_suppression_list (email, reason, source_system)
VALUES ('lifted@example.com', 'complaint', 'notifications');

SELECT is(
  (SELECT count(*)::int FROM email_suppression_list WHERE lower(email) = 'lifted@example.com'),
  2,
  'active + lifted suppression can coexist for the same email'
);

-- ============================================================
-- 4. email_unsubscribes partial unique indexes
--    (a) campaign-specific: UNIQUE(user_id, campaign_id) WHERE campaign_id IS NOT NULL
--    (b) global: UNIQUE(user_id) WHERE campaign_id IS NULL
-- ============================================================

-- 4a. Campaign-specific unsubscribe
INSERT INTO email_unsubscribes (user_id, campaign_id)
VALUES (:'test_user_id', :'campaign_id');

SELECT throws_ok(
  format(
    $$INSERT INTO email_unsubscribes (user_id, campaign_id)
      VALUES ('%s', '%s')$$,
    :'test_user_id', :'campaign_id'
  ),
  '23505',
  NULL,
  'unsubscribe partial unique rejects duplicate campaign-specific unsubscribe'
);

-- 4b. Global unsubscribe (campaign_id IS NULL)
INSERT INTO email_unsubscribes (user_id)
VALUES (:'test_user_id');

SELECT throws_ok(
  format(
    $$INSERT INTO email_unsubscribes (user_id, campaign_id)
      VALUES ('%s', NULL)$$,
    :'test_user_id'
  ),
  '23505',
  NULL,
  'unsubscribe partial unique rejects duplicate global unsubscribe'
);

-- ============================================================
-- 5. FK CASCADE: deleting a campaign cascade-deletes
--    steps and enrollments
-- ============================================================

-- Create a second campaign for cascade testing
INSERT INTO email_campaigns (name, campaign_type, status)
VALUES ('PGTAP Cascade Campaign', 'broadcast', 'draft')
RETURNING id AS cascade_campaign_id \gset

INSERT INTO email_campaign_steps (campaign_id, step_order, subject, template_id)
VALUES (:'cascade_campaign_id', 1, 'Cascade Step', 'test/cascade');

INSERT INTO email_campaign_enrollments (campaign_id, user_id, status)
VALUES (:'cascade_campaign_id', :'test_user_id_2', 'active');

DELETE FROM email_campaigns WHERE id = :'cascade_campaign_id';

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM email_campaign_steps WHERE campaign_id = :'cascade_campaign_id'
  ),
  'deleting campaign cascade-deletes its steps'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM email_campaign_enrollments WHERE campaign_id = :'cascade_campaign_id'
  ),
  'deleting campaign cascade-deletes its enrollments'
);

-- ============================================================
-- 6. FK SET NULL: deleting an enrollment sets
--    email_sends.enrollment_id to NULL (not deletes the send)
-- ============================================================

-- Use the existing enrollment for test_user_id in campaign_id
-- First grab the enrollment id
SELECT id AS enrollment_id
FROM email_campaign_enrollments
WHERE campaign_id = :'campaign_id' AND user_id = :'test_user_id'
\gset

INSERT INTO email_sends (enrollment_id, campaign_id, step_id, user_id, to_email, status)
VALUES (:'enrollment_id', :'campaign_id', :'step_1_id', :'test_user_id', 'pgtap-email-campaigns@example.com', 'sent')
RETURNING id AS send_id \gset

DELETE FROM email_campaign_enrollments WHERE id = :'enrollment_id';

SELECT ok(
  EXISTS (
    SELECT 1 FROM email_sends WHERE id = :'send_id'
  ),
  'deleting enrollment does NOT delete the email_send row'
);

SELECT is(
  (SELECT enrollment_id FROM email_sends WHERE id = :'send_id'),
  NULL::uuid,
  'deleting enrollment sets email_sends.enrollment_id to NULL'
);

SELECT * FROM finish();

ROLLBACK;
