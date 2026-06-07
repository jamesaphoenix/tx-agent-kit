/**
 * Centralized configuration constants shared across the application.
 * Move magic numbers here instead of hardcoding in service files.
 */

import type { AuthRateLimitedPath } from './literals.js'

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

// ── Auth Rate Limiting ───────────────────────────────────────────────
//
// Per-endpoint abuse caps for the auth surface. Sign-up and the
// password-recovery endpoints are tightened far below the default
// sign-in/refresh budget: a legitimate user hits them rarely, whereas
// they are the prime targets for scripted account-farming and
// mail-flood abuse. These are the DEFAULTS (real prod behaviour).
// `apps/api` resolves them against explicit `AUTH_RATE_LIMIT_*` env
// overrides, so an individual environment can loosen or disable a
// limit without a code change (the integration harness disables them
// this way by setting the env override to a very large number).

export interface AuthRateLimitPolicy {
  /** Sliding-window length in seconds. */
  readonly windowSeconds: number
  /** Max requests per client IP within the window. */
  readonly maxPerIp: number
  /** Max requests per normalized identifier (email) within the window. */
  readonly maxPerIdentifier: number
  /** Extra lockout (seconds) applied after the cap is exceeded; 0 = none. */
  readonly blockSeconds: number
}

export const DEFAULT_AUTH_RATE_LIMIT: AuthRateLimitPolicy = {
  windowSeconds: 60,
  maxPerIp: 15,
  maxPerIdentifier: 15,
  blockSeconds: 0
} as const

/**
 * Per-path overrides of {@link DEFAULT_AUTH_RATE_LIMIT}. Any path not
 * listed here inherits the default. Keyed by the same strings as
 * `authRateLimitedPaths` so the two stay in lockstep.
 */
export const AUTH_RATE_LIMIT_POLICIES: Partial<Record<AuthRateLimitedPath, AuthRateLimitPolicy>> = {
  // A person signs up once. 5/IP/hour covers shared office/family NAT
  // while blocking scripted mass-signup; 3/email/hour stops retry loops.
  '/v1/auth/sign-up': { windowSeconds: 3600, maxPerIp: 5, maxPerIdentifier: 3, blockSeconds: 0 },
  // Password-reset email senders, tightened to curb mail-flood abuse.
  '/v1/auth/forgot-password': { windowSeconds: 900, maxPerIp: 5, maxPerIdentifier: 3, blockSeconds: 0 },
  '/v1/auth/reset-password': { windowSeconds: 900, maxPerIp: 10, maxPerIdentifier: 5, blockSeconds: 0 }
} as const

/** Resolves the baseline (pre-env-override) policy for an auth path. */
export const getDefaultAuthRateLimitPolicy = (path: AuthRateLimitedPath): AuthRateLimitPolicy =>
  AUTH_RATE_LIMIT_POLICIES[path] ?? DEFAULT_AUTH_RATE_LIMIT
