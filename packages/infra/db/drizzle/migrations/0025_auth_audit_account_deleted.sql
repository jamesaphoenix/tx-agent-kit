-- 0025_auth_audit_account_deleted.sql
-- Add 'account_deleted' value to auth_login_audit_event_type enum for deletion audit trail.

ALTER TYPE auth_login_audit_event_type ADD VALUE IF NOT EXISTS 'account_deleted';
