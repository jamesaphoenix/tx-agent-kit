import { Effect } from 'effect'
import { TooManyRequests } from '../api.js'

/**
 * Per-org in-process rate limiter for Stripe session-creation
 * endpoints: `createCheckoutSession`, `createPortalSession`, and
 * `createTopUpSession`. Each of those endpoints calls Stripe, and
 * each Stripe call costs money and burns rate against our Stripe
 * account. Without a limiter, an authenticated attacker could spam
 * them and we'd foot the bill + potentially get throttled by Stripe.
 *
 * The limit is intentionally generous for genuine users (a person
 * spam-clicking "Buy credits" is the worst case): 10 requests per
 * 60 seconds per organization, bucketed per (path, organizationId)
 * so the three endpoints don't share a budget. For an org that
 * hits the limit, the response is a 429 with a Retry-After header.
 *
 * Implementation mirrors the `authRateLimitMiddleware` pattern —
 * an in-process Map of bucket -> attempt timestamps, pruned
 * opportunistically on each check. This is process-local so a
 * determined attacker behind multiple API instances could exceed
 * the limit proportionally; replacing with a Redis-backed bucket
 * is a future upgrade once we horizontally scale API.
 */

const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 10
const MAX_BUCKETS = 50_000

export const billingRateLimitPaths = [
  'createCheckoutSession',
  'createPortalSession',
  'createTopUpSession'
] as const
export type BillingRateLimitPath = (typeof billingRateLimitPaths)[number]

const buckets = new Map<string, number[]>()

const filterToWindow = (attempts: readonly number[], nowMs: number): number[] =>
  attempts.filter((ts) => nowMs - ts < WINDOW_MS)

const pruneStaleBuckets = (nowMs: number): void => {
  for (const [key, attempts] of buckets.entries()) {
    const recent = filterToWindow(attempts, nowMs)
    if (recent.length === 0) {
      buckets.delete(key)
      continue
    }
    buckets.set(key, recent)
  }
}

export interface BillingRateLimitDecision {
  limited: boolean
  retryAfterSeconds: number
}

export const consumeBillingRateLimit = (
  path: BillingRateLimitPath,
  organizationId: string
): BillingRateLimitDecision => {
  const nowMs = Date.now()
  pruneStaleBuckets(nowMs)

  const bucketKey = `${path}:${organizationId}`

  // Cap the total Map size so a flood of distinct org ids can't
  // blow up memory. Once saturated, new org ids are rejected with
  // `limited: true` until existing buckets age out.
  if (buckets.size >= MAX_BUCKETS && !buckets.has(bucketKey)) {
    return { limited: true, retryAfterSeconds: Math.ceil(WINDOW_MS / 1000) }
  }

  const currentAttempts = buckets.get(bucketKey) ?? []
  const recentAttempts = filterToWindow(currentAttempts, nowMs)

  if (recentAttempts.length >= MAX_REQUESTS_PER_WINDOW) {
    buckets.set(bucketKey, recentAttempts)
    return { limited: true, retryAfterSeconds: Math.ceil(WINDOW_MS / 1000) }
  }

  recentAttempts.push(nowMs)
  buckets.set(bucketKey, recentAttempts)
  return { limited: false, retryAfterSeconds: 0 }
}

export const checkBillingRateLimit = (
  path: BillingRateLimitPath,
  organizationId: string
): Effect.Effect<void, TooManyRequests> => {
  const decision = consumeBillingRateLimit(path, organizationId)
  if (decision.limited) {
    return Effect.fail(new TooManyRequests({
      message: `Too many ${path} requests — try again in ${decision.retryAfterSeconds}s`
    }))
  }
  return Effect.void
}

/**
 * Test-only reset. Called by the integration test to clear buckets
 * between specs so each test starts from a known state.
 */
export const __resetBillingRateLimitForTest = (): void => {
  buckets.clear()
}
