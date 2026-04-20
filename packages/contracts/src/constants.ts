/**
 * Centralized configuration constants shared across the application.
 * Move magic numbers here instead of hardcoding in service files.
 */

// ── Upload & Storage ─────────────────────────────────────────────────

export const UPLOAD_EXPIRY_SECONDS = 3600
export const SIGNED_URL_EXPIRY_SECONDS = 3600
export const DEFAULT_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB
export const STORAGE_HARD_CAP_MULTIPLIER = 2

// ── Retention Cleaner ────────────────────────────────────────────────

export const RETENTION_CLEANER_BATCH_SIZE = 100
export const PURGE_BATCH_SIZE = 500

// ── Billing: Payment Failure Lifecycle ──────────────────────────────
//
// Days between an `invoice.payment_failed` webhook and hard suspension.
// The spec (§"Payment Failure Lifecycle") says operations are suspended
// (reads allowed, no new AI/uploads) during this window, giving the org
// time to update their payment method. Previously this constant lived
// only in `apps/worker/src/workflows.ts` — moved here so the API
// webhook handler can set `paymentGracePeriodEndsAt` synchronously
// with the `status='past_due'` write, closing the short window where
// the column was null but the org was effectively in grace period.
export const PAYMENT_GRACE_PERIOD_DAYS = 7
export const PAYMENT_GRACE_PERIOD_MS = PAYMENT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
