-- Migration: organizations welcome credit
--
-- Adds the `welcome_credit_granted_at` timestamp column to organizations.
-- This column is the one-time guard for the welcome credit grant: the
-- invoice.payment_succeeded webhook handler only writes a welcome credit
-- ledger entry when this column is NULL, then sets it to now() in the same
-- transaction. Upgrades do not re-grant (the column is already set).
--
-- @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
-- @spec INV-BILLING-CREDITS-NEVER-EXPIRE

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "welcome_credit_granted_at" timestamptz;
