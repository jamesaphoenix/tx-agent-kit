import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAuthRateLimitBypassToken, resetApiEnvCache } from './env.js'

const baseEnv: Record<string, string> = {
  NODE_ENV: 'test',
  API_PORT: '4000',
  API_HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  API_CORS_ORIGIN: 'http://localhost:3000'
}

const MANAGED_ENV_KEYS = [...Object.keys(baseEnv), 'AUTH_RATE_LIMIT_BYPASS_TOKEN'] as const

describe('getAuthRateLimitBypassToken', () => {
  let originalEnv: Record<string, string | undefined>

  const applyBypassEnv = (value: string | undefined): void => {
    for (const key of MANAGED_ENV_KEYS) {
      delete process.env[key]
    }
    for (const [key, val] of Object.entries(baseEnv)) {
      process.env[key] = val
    }
    if (value === undefined) {
      delete process.env.AUTH_RATE_LIMIT_BYPASS_TOKEN
    } else {
      process.env.AUTH_RATE_LIMIT_BYPASS_TOKEN = value
    }
    resetApiEnvCache()
  }

  beforeEach(() => {
    originalEnv = {}
    for (const key of MANAGED_ENV_KEYS) {
      originalEnv[key] = process.env[key]
    }
    resetApiEnvCache()
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    resetApiEnvCache()
  })

  it('returns null when unset (bypass impossible)', () => {
    applyBypassEnv(undefined)
    expect(getAuthRateLimitBypassToken()).toBeNull()
  })

  it('returns null when blank/whitespace-only', () => {
    applyBypassEnv('   ')
    expect(getAuthRateLimitBypassToken()).toBeNull()
  })

  it('returns the trimmed token when configured', () => {
    applyBypassEnv('  deploy-smoke-secret  ')
    expect(getAuthRateLimitBypassToken()).toBe('deploy-smoke-secret')
  })
})
