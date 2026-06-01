import { randomUUID } from 'node:crypto'
import { HttpApp, HttpServerResponse } from '@effect/platform'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetApiEnvCache } from '../config/env.js'
import { authRateLimitMiddleware } from './auth-rate-limit.js'

const baseEnv: Record<string, string> = {
  NODE_ENV: 'test',
  API_PORT: '4000',
  API_HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  API_CORS_ORIGIN: 'http://localhost:3000'
}

const MANAGED_ENV_KEYS = [
  ...Object.keys(baseEnv),
  'AUTH_RATE_LIMIT_WINDOW_MS',
  'AUTH_RATE_LIMIT_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_BYPASS_TOKEN',
  'TRUST_PROXY'
] as const

let snapshot: Record<string, string | undefined> = {}

const applyEnv = (overrides: Record<string, string | undefined>): void => {
  for (const key of MANAGED_ENV_KEYS) {
    delete process.env[key]
  }
  for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  resetApiEnvCache()
}

beforeEach(() => {
  snapshot = {}
  for (const key of MANAGED_ENV_KEYS) {
    snapshot[key] = process.env[key]
  }
  resetApiEnvCache()
})

afterEach(() => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  resetApiEnvCache()
})

// The deploy smoke test bypasses the limiter with a secret header so repeated
// deploys from one egress IP don't exhaust the per-IP sign-up budget.
describe('authRateLimitMiddleware bypass token', () => {
  const bypassToken = 'deploy-smoke-bypass-token-0123456789abcdef'
  const url = 'http://api/v1/auth/sign-up'

  const runWithHeaders = async (headers: Record<string, string>): Promise<number> => {
    const app: HttpApp.Default = Effect.succeed(HttpServerResponse.empty({ status: 200 }))
    const handler = HttpApp.toWebHandler(app, authRateLimitMiddleware)
    const response = await handler(new Request(url, { method: 'POST', headers }))
    return response.status
  }

  const freshIp = (): string => `203.0.113.${Math.floor(Math.random() * 254) + 1}-${randomUUID()}`

  it('lets requests with the configured bypass token skip the limiter', async () => {
    applyEnv({
      TRUST_PROXY: 'true',
      AUTH_RATE_LIMIT_MAX_REQUESTS: '5',
      AUTH_RATE_LIMIT_BYPASS_TOKEN: bypassToken
    })
    const ip = freshIp()

    const statuses: number[] = []
    // Well past the 5/IP cap — every one is allowed via the bypass.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      statuses.push(
        await runWithHeaders({ 'x-forwarded-for': ip, 'x-auth-rate-limit-bypass': bypassToken })
      )
    }

    expect(statuses.every((status) => status === 200)).toBe(true)
  })

  it('still limits when the bypass header value is wrong', async () => {
    applyEnv({
      TRUST_PROXY: 'true',
      AUTH_RATE_LIMIT_MAX_REQUESTS: '5',
      AUTH_RATE_LIMIT_BYPASS_TOKEN: bypassToken
    })
    const ip = freshIp()

    const statuses: number[] = []
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      statuses.push(
        await runWithHeaders({ 'x-forwarded-for': ip, 'x-auth-rate-limit-bypass': 'not-the-token' })
      )
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(1)
  })

  it('ignores the bypass header when no token is configured (fails closed)', async () => {
    applyEnv({ TRUST_PROXY: 'true', AUTH_RATE_LIMIT_MAX_REQUESTS: '5' })
    const ip = freshIp()

    const statuses: number[] = []
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      statuses.push(
        await runWithHeaders({ 'x-forwarded-for': ip, 'x-auth-rate-limit-bypass': bypassToken })
      )
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(1)
  })
})
