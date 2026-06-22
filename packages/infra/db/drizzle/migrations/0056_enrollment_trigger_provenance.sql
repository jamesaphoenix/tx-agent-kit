-- Enrollment provenance (REQ-LIFECYCLE-051): record which source domain event
-- created (or re-enrolled) each enrollment, so an enrollment can always be traced
-- back to the lifecycle/billing event that produced it. Additive + nullable: the
-- manual enroll path and any pre-existing rows leave both columns null. No FK to
-- domain_events (that table has its own retention), so this is a soft reference.

ALTER TABLE email_campaign_enrollments ADD COLUMN IF NOT EXISTS trigger_event_type TEXT;
ALTER TABLE email_campaign_enrollments ADD COLUMN IF NOT EXISTS trigger_event_id UUID;
