import { randomUUID } from 'node:crypto'
import { HttpApp, HttpServerResponse } from '@effect/platform'
import { metrics } from '@opentelemetry/api'
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics
} from '@opentelemetry/sdk-metrics'
import {
  _resetAuthSecurityMetricsRegistryForTest,
  authRateLimitRejectedMetricName
} from '@tx-agent-kit/observability'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetApiEnvCache } from '../config/env.js'
import {
  __resetAuthRateLimitForTest,
  authRateLimitMiddleware,
  consumeAuthIdentifierRateLimit,
  consumeAuthIpRateLimit
} from './auth-rate-limit.js'

// Exercises the Redis-backed auth rate limiter against the live infra
// Redis (pnpm infra:ensure). Each assertion uses a unique IP/email so the
// per-key counter starts fresh regardless of prior runs within the long
// window.

const AUTH_RATE_LIMIT_ENV_KEYS = [
  'AUTH_RATE_LIMIT_WINDOW_MS',
  'AUTH_RATE_LIMIT_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_BYPASS_TOKEN',
  'TRUST_PROXY'
] as const

const baseEnv: Record<string, string> = {
  // staging (not development) so rate limiting is active, it is disabled in dev.
  NODE_ENV: 'staging',
  API_PORT: '4000',
  API_HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  API_CORS_ORIGIN: 'http://localhost:3000',
  REDIS_URL: process.env.REDIS_URL ?? `redis://127.0.0.1:${process.env.REDIS_PORT ?? '6379'}`
}

let snapshot: Record<string, string | undefined> = {}

const applyEnv = (overrides: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  resetApiEnvCache()
  __resetAuthRateLimitForTest()
}

beforeEach(() => {
  const keys = [...Object.keys(baseEnv), ...AUTH_RATE_LIMIT_ENV_KEYS]
  snapshot = {}
  for (const key of keys) {
    snapshot[key] = process.env[key]
  }
  // Clear any ambient override so the per-path contract defaults apply.
  for (const key of AUTH_RATE_LIMIT_ENV_KEYS) {
    delete process.env[key]
  }
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
  __resetAuthRateLimitForTest()
})

describe('auth rate limiter (Redis-backed)', () => {
  it('enforces the sign-up default of 5 requests per IP', async () => {
    applyEnv({})
    const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}-${randomUUID()}`

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const decision = await consumeAuthIpRateLimit('/v1/auth/sign-up', ip)
      expect(decision.limited, `attempt ${attempt} should be allowed`).toBe(false)
    }

    const throttled = await consumeAuthIpRateLimit('/v1/auth/sign-up', ip)
    expect(throttled.limited).toBe(true)
    expect(throttled.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('enforces the sign-up default of 3 requests per identifier (email)', async () => {
    applyEnv({})
    const email = `signup-${randomUUID()}@example.com`

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const decision = await consumeAuthIdentifierRateLimit('/v1/auth/sign-up', email)
      expect(decision.limited, `attempt ${attempt} should be allowed`).toBe(false)
    }

    const throttled = await consumeAuthIdentifierRateLimit('/v1/auth/sign-up', email)
    expect(throttled.limited).toBe(true)
  })

  it('keeps the IP and identifier buckets independent', async () => {
    applyEnv({})
    const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}-${randomUUID()}`

    // Exhaust the IP bucket (5) but the identifier bucket must remain open.
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await consumeAuthIpRateLimit('/v1/auth/sign-up', ip)
    }

    const idDecision = await consumeAuthIdentifierRateLimit(
      '/v1/auth/sign-up',
      `fresh-${randomUUID()}@example.com`
    )
    expect(idDecision.limited).toBe(false)
  })

  it('does not limit sign-in within the generous default budget', async () => {
    applyEnv({})
    const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}-${randomUUID()}`

    // Sign-in keeps the default 15/min budget, 6 quick attempts are fine.
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const decision = await consumeAuthIpRateLimit('/v1/auth/sign-in', ip)
      expect(decision.limited).toBe(false)
    }
  })

  it('disables rate limiting entirely in local development', async () => {
    applyEnv({ NODE_ENV: 'development' })
    const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}-${randomUUID()}`

    // Well past the 5/IP sign-up cap, dev must never lock you out.
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const decision = await consumeAuthIpRateLimit('/v1/auth/sign-up', ip)
      expect(decision.limited).toBe(false)
    }
  })

  it('lets an explicit env override disable the tight sign-up default (harness path)', async () => {
    applyEnv({ AUTH_RATE_LIMIT_MAX_REQUESTS: '100000', AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS: '100000' })
    const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}-${randomUUID()}`

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const decision = await consumeAuthIpRateLimit('/v1/auth/sign-up', ip)
      expect(decision.limited).toBe(false)
    }
  })
})

// The rejection-counter emit lives in the HTTP middleware (it is the only
// place that knows a request was actually rejected with a 429). Drive the
// middleware directly with an in-memory MeterProvider so we can assert the
// counter increments once per rejected request and stays labelled by the
// bounded limited path (never a raw URL).
describe('authRateLimitMiddleware rejection metrics', () => {
  let exporter: InMemoryMetricExporter
  let reader: PeriodicExportingMetricReader
  let meterProvider: MeterProvider

  const collect = async (): Promise<ResourceMetrics[]> => {
    await meterProvider.forceFlush()
    return exporter.getMetrics()
  }

  interface DataPoint {
    readonly attributes: Record<string, unknown>
    readonly value: unknown
  }

  const dataPointsFor = (
    resourceMetrics: ResourceMetrics[],
    metricName: string
  ): DataPoint[] =>
    resourceMetrics
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .filter((m) => m.descriptor.name === metricName)
      .flatMap((m) => m.dataPoints as DataPoint[])

  beforeEach(() => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
    reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })
    meterProvider = new MeterProvider({ readers: [reader] })
    metrics.disable()
    metrics.setGlobalMeterProvider(meterProvider)
    _resetAuthSecurityMetricsRegistryForTest()
  })

  afterEach(async () => {
    await reader.shutdown()
    metrics.disable()
  })

  const runThroughMiddleware = async (url: string, clientIp: string): Promise<number> => {
    const app: HttpApp.Default = Effect.succeed(HttpServerResponse.empty({ status: 200 }))
    const handler = HttpApp.toWebHandler(app, authRateLimitMiddleware)
    const response = await handler(
      new Request(url, { method: 'POST', headers: { 'x-forwarded-for': clientIp } })
    )
    return response.status
  }

  it('increments the rejected counter once per 429, labelled by the limited path', async () => {
    // TRUST_PROXY lets the limiter key off x-forwarded-for so each test isolates
    // a unique Redis bucket (the live Redis state survives the in-memory reset).
    applyEnv({ TRUST_PROXY: 'true' })
    const url = 'http://api/v1/auth/sign-up'
    const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}-${randomUUID()}`

    // Sign-up default is 5/IP, so the 6th+ requests are rejected with a 429.
    const statuses: number[] = []
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      statuses.push(await runThroughMiddleware(url, ip))
    }

    const rejected = statuses.filter((s) => s === 429).length
    expect(rejected).toBeGreaterThanOrEqual(1)

    const collected = await collect()
    const point = dataPointsFor(collected, authRateLimitRejectedMetricName).find(
      (p) => p.attributes.path === '/v1/auth/sign-up'
    )
    expect(point).toBeDefined()
    expect(point?.value).toBe(rejected)
    // The metric must carry the bounded literal path, never the raw URL.
    expect(JSON.stringify(point?.attributes)).not.toContain('http://api')
  })

  it('does not emit the rejected counter when the request is allowed', async () => {
    applyEnv({ TRUST_PROXY: 'true' })
    const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}-${randomUUID()}`
    const status = await runThroughMiddleware('http://api/v1/auth/sign-up', ip)
    expect(status).toBe(200)

    const collected = await collect()
    const points = dataPointsFor(collected, authRateLimitRejectedMetricName)
    expect(points).toHaveLength(0)
  })
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
    applyEnv({ TRUST_PROXY: 'true', AUTH_RATE_LIMIT_BYPASS_TOKEN: bypassToken })
    const ip = freshIp()

    const statuses: number[] = []
    // Well past the 5/IP sign-up cap, every one is allowed via the bypass.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      statuses.push(await runWithHeaders({ 'x-forwarded-for': ip, 'x-auth-rate-limit-bypass': bypassToken }))
    }

    expect(statuses.every((status) => status === 200)).toBe(true)
  })

  it('still limits when the bypass header value is wrong', async () => {
    applyEnv({ TRUST_PROXY: 'true', AUTH_RATE_LIMIT_BYPASS_TOKEN: bypassToken })
    const ip = freshIp()

    const statuses: number[] = []
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      statuses.push(await runWithHeaders({ 'x-forwarded-for': ip, 'x-auth-rate-limit-bypass': 'not-the-token' }))
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(1)
  })

  it('ignores the bypass header when no token is configured (fails closed)', async () => {
    applyEnv({ TRUST_PROXY: 'true' })
    const ip = freshIp()

    const statuses: number[] = []
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      statuses.push(await runWithHeaders({ 'x-forwarded-for': ip, 'x-auth-rate-limit-bypass': bypassToken }))
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(1)
  })
})
