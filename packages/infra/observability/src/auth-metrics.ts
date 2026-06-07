import type { Counter, Meter } from '@opentelemetry/api'

import { getMetricsMeter } from './metrics-meter.js'

export const authRateLimitRejectedMetricName =
  'tx_agent_kit_auth_rate_limit_rejected_total'
export const turnstileVerificationMetricName = 'tx_agent_kit_turnstile_verification_total'

/**
 * Outcome of a Turnstile verification attempt.
 * - `success` / `failed`: explicit siteverify result.
 * - `unreachable`: siteverify transport error, we fail OPEN (allow) but record it,
 *   so a Cloudflare hiccup is visible without taking sign-up offline.
 */
export type TurnstileVerificationResult = 'success' | 'failed' | 'unreachable'

export interface AuthSecurityMetrics {
  readonly rateLimitRejectedCounter: Counter
  readonly turnstileVerificationCounter: Counter
}

const registry = new Map<Meter, AuthSecurityMetrics>()

export const getOrCreateAuthSecurityMetrics = (meter: Meter): AuthSecurityMetrics => {
  const existing = registry.get(meter)
  if (existing) {
    return existing
  }

  const created: AuthSecurityMetrics = {
    rateLimitRejectedCounter: meter.createCounter(authRateLimitRejectedMetricName, {
      unit: '{rejection}',
      description: 'Auth requests rejected by the rate limiter, by limited path.'
    }),
    turnstileVerificationCounter: meter.createCounter(turnstileVerificationMetricName, {
      unit: '{verification}',
      description: 'Turnstile verification attempts, by result.'
    })
  }

  registry.set(meter, created)
  return created
}

const metricsForCurrentMeter = (): AuthSecurityMetrics =>
  getOrCreateAuthSecurityMetrics(getMetricsMeter())

/** `path` MUST be a bounded, literal-typed limited path, never a raw URL. */
export const recordAuthRateLimitRejected = (path: string): void => {
  metricsForCurrentMeter().rateLimitRejectedCounter.add(1, { path })
}

export const recordTurnstileVerification = (
  result: TurnstileVerificationResult
): void => {
  metricsForCurrentMeter().turnstileVerificationCounter.add(1, { result })
}

export const _resetAuthSecurityMetricsRegistryForTest = (): void => {
  registry.clear()
}
