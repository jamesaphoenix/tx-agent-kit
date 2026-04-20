import { randomUUID } from 'node:crypto'
import {
  browserAuthSessionModeHeaderName
} from '@tx-agent-kit/contracts'
import { describe, expect, it } from 'vitest'
import {
  createTestFixture,
  healthReadinessLatencyBudgetMs,
  healthBurstRequestCount,
  healthBurstLatencyBudgetMs
} from './test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { dbAuthContext, request } = createTestFixture({
  schemaPrefix: 'api_infra'
})

describe('api infra integration', () => {
  it('exposes health endpoint for readiness checks', async () => {
    const startedAt = globalThis.performance.now()
    const health = await request<{ status: string; timestamp: string; service: string }>(
      '/health',
      'health-endpoint'
    )
    const durationMs = globalThis.performance.now() - startedAt

    expect(health.response.status).toBe(200)
    expect(health.body.status).toBe('healthy')
    expect(health.body.service).toBe('tx-agent-kit-api')
    expect(health.body.timestamp).toBeTruthy()
    expect(durationMs).toBeLessThan(healthReadinessLatencyBudgetMs)
  })

  it('serves concurrent health checks successfully within burst budget', async () => {
    const startedAt = globalThis.performance.now()

    const healthResponses = await Promise.all(
      Array.from({ length: healthBurstRequestCount }, (_, index) =>
        request<{ status: string; service: string }>(
          '/health',
          `health-endpoint-burst-${index}`
        )
      )
    )

    const durationMs = globalThis.performance.now() - startedAt

    for (const health of healthResponses) {
      expect(health.response.status).toBe(200)
      expect(health.body.status).toBe('healthy')
      expect(health.body.service).toBe('tx-agent-kit-api')
    }
    expect(durationMs).toBeLessThan(healthBurstLatencyBudgetMs)
  })

  it('sets mandatory security headers on API responses', async () => {
    const signIn = await fetch(`${dbAuthContext.baseUrl}/v1/auth/sign-in`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.200',
        ...dbAuthContext.testContext.headersForCase('security-headers-sign-in')
      },
      body: JSON.stringify({
        email: `security-headers-probe-${uid}@example.com`,
        password: 'does-not-matter'
      })
    })

    expect(signIn.headers.get('x-content-type-options')).toBe('nosniff')
    expect(signIn.headers.get('x-frame-options')).toBe('DENY')
    expect(signIn.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(signIn.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()')
    expect(signIn.headers.get('cache-control')).toBe('no-store')
    expect(signIn.headers.get('x-download-options')).toBe('noopen')
    expect(signIn.headers.get('x-permitted-cross-domain-policies')).toBe('none')
    expect(signIn.headers.get('strict-transport-security')).toContain('max-age=')
    expect(signIn.headers.get('strict-transport-security')).toContain('includeSubDomains')
  })

  it('returns CORS headers for allowed origin and rejects disallowed origins', async () => {
    const allowedPreflight = await fetch(`${dbAuthContext.baseUrl}/v1/auth/sign-in`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': `content-type,authorization,${browserAuthSessionModeHeaderName}`,
        ...dbAuthContext.testContext.headersForCase('cors-allowed-preflight')
      }
    })

    const allowedOriginHeader = allowedPreflight.headers.get('access-control-allow-origin')
    expect(allowedOriginHeader).toBe('http://localhost:3000')

    const disallowedPreflight = await fetch(`${dbAuthContext.baseUrl}/v1/auth/sign-in`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.attacker.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': `content-type,authorization,${browserAuthSessionModeHeaderName}`,
        ...dbAuthContext.testContext.headersForCase('cors-disallowed-preflight')
      }
    })

    const disallowedOriginHeader = disallowedPreflight.headers.get('access-control-allow-origin')
    expect(disallowedOriginHeader).not.toBe('https://evil.attacker.example')
    expect(disallowedOriginHeader).not.toBe('*')
  })
})
