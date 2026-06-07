import { describe, expect, it } from 'vitest'
import {
  AUTH_RATE_LIMIT_POLICIES,
  DEFAULT_AUTH_RATE_LIMIT,
  getDefaultAuthRateLimitPolicy
} from './constants.js'
import { authRateLimitedPaths } from './literals.js'

describe('auth rate limit policy contract', () => {
  it('tightens sign-up well below the default budget', () => {
    const signUp = getDefaultAuthRateLimitPolicy('/v1/auth/sign-up')

    // A legit user signs up once; the cap must be far below the
    // sign-in/refresh default so one IP cannot farm accounts.
    expect(signUp.maxPerIp).toBeLessThan(DEFAULT_AUTH_RATE_LIMIT.maxPerIp)
    expect(signUp.maxPerIdentifier).toBeLessThanOrEqual(signUp.maxPerIp)
    // Longer window than the 60s default; abuse is measured per hour.
    expect(signUp.windowSeconds).toBeGreaterThan(DEFAULT_AUTH_RATE_LIMIT.windowSeconds)
  })

  it('tightens password-recovery endpoints to curb mail-flood abuse', () => {
    const forgot = getDefaultAuthRateLimitPolicy('/v1/auth/forgot-password')
    const reset = getDefaultAuthRateLimitPolicy('/v1/auth/reset-password')

    expect(forgot.maxPerIp).toBeLessThan(DEFAULT_AUTH_RATE_LIMIT.maxPerIp)
    expect(reset.maxPerIp).toBeLessThanOrEqual(DEFAULT_AUTH_RATE_LIMIT.maxPerIp)
  })

  it('falls back to the default policy for paths without an override', () => {
    expect(getDefaultAuthRateLimitPolicy('/v1/auth/sign-in')).toBe(DEFAULT_AUTH_RATE_LIMIT)
    expect(getDefaultAuthRateLimitPolicy('/v1/auth/refresh')).toBe(DEFAULT_AUTH_RATE_LIMIT)
  })

  it('only overrides paths that are actually rate-limited', () => {
    const limited = new Set<string>(authRateLimitedPaths)
    for (const path of Object.keys(AUTH_RATE_LIMIT_POLICIES)) {
      expect(limited.has(path)).toBe(true)
    }
  })

  it('uses positive, internally-consistent numbers for every policy', () => {
    for (const path of authRateLimitedPaths) {
      const policy = getDefaultAuthRateLimitPolicy(path)
      expect(policy.windowSeconds).toBeGreaterThan(0)
      expect(policy.maxPerIp).toBeGreaterThan(0)
      expect(policy.maxPerIdentifier).toBeGreaterThan(0)
      expect(policy.blockSeconds).toBeGreaterThanOrEqual(0)
    }
  })
})
