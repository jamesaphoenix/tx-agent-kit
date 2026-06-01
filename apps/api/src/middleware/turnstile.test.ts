import type { HttpServerRequest } from '@effect/platform'
import { Effect, Option } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetApiEnvCache } from '../config/env.js'
import {
  TURNSTILE_RESPONSE_HEADER,
  enforceTurnstile,
  verifyTurnstileToken
} from './turnstile.js'

const VERIFY_URL = 'https://challenges.example.test/siteverify'

const jsonResponse = (body: unknown, ok = true): Response =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body)
  }) as unknown as Response

// Minimal fake request exposing the headers + remoteAddress the middleware reads.
const fakeRequest = (headers: Record<string, string>): HttpServerRequest.HttpServerRequest =>
  ({
    headers,
    remoteAddress: Option.some('203.0.113.5')
  }) as unknown as HttpServerRequest.HttpServerRequest

const baseEnv: Record<string, string> = {
  NODE_ENV: 'development',
  API_PORT: '4000',
  API_HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  API_CORS_ORIGIN: 'http://localhost:3000'
}

const TURNSTILE_KEYS = ['TURNSTILE_SECRET_KEY', 'TURNSTILE_VERIFY_URL'] as const

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
}

beforeEach(() => {
  snapshot = {}
  for (const key of [...Object.keys(baseEnv), ...TURNSTILE_KEYS]) {
    snapshot[key] = process.env[key]
  }
  for (const key of TURNSTILE_KEYS) {
    delete process.env[key]
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  resetApiEnvCache()
})

describe('verifyTurnstileToken', () => {
  it('returns success for a passing token and forwards the remote IP', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true }))

    const result = await verifyTurnstileToken({
      secretKey: 'secret',
      token: 'good-token',
      verifyUrl: VERIFY_URL,
      remoteIp: '203.0.113.5'
    })

    expect(result.success).toBe(true)
    const [, init] = fetchSpy.mock.calls[0] ?? []
    const body = (init?.body as URLSearchParams).toString()
    expect(body).toContain('secret=secret')
    expect(body).toContain('response=good-token')
    expect(body).toContain('remoteip=203.0.113.5')
  })

  it('returns failure with error codes for a rejected token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: false, 'error-codes': ['invalid-input-response'] })
    )

    const result = await verifyTurnstileToken({
      secretKey: 'secret',
      token: 'bad-token',
      verifyUrl: VERIFY_URL
    })

    expect(result.success).toBe(false)
    expect(result.errorCodes).toContain('invalid-input-response')
  })

  it('throws on a non-OK siteverify response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, false))

    await expect(
      verifyTurnstileToken({ secretKey: 's', token: 't', verifyUrl: VERIFY_URL })
    ).rejects.toThrow(/HTTP 500/)
  })
})

describe('enforceTurnstile', () => {
  it('is a no-op when no secret is configured (test/dev without a key)', async () => {
    applyEnv({})
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await Effect.runPromise(enforceTurnstile(fakeRequest({})))

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects with 400 when the captcha token header is missing', async () => {
    applyEnv({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_VERIFY_URL: VERIFY_URL })

    const exit = await Effect.runPromiseExit(enforceTurnstile(fakeRequest({})))
    expect(exit._tag).toBe('Failure')
  })

  it('rejects with 403 when verification fails', async () => {
    applyEnv({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_VERIFY_URL: VERIFY_URL })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: false }))

    const exit = await Effect.runPromiseExit(
      enforceTurnstile(fakeRequest({ [TURNSTILE_RESPONSE_HEADER]: 'bad' }))
    )
    expect(exit._tag).toBe('Failure')
  })

  it('passes when verification succeeds', async () => {
    applyEnv({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_VERIFY_URL: VERIFY_URL })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true }))

    await Effect.runPromise(enforceTurnstile(fakeRequest({ [TURNSTILE_RESPONSE_HEADER]: 'ok' })))
  })

  it('fails open (allows) when siteverify is unreachable', async () => {
    applyEnv({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_VERIFY_URL: VERIFY_URL })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    // Should resolve (not fail) — infra error must not block sign-up.
    await Effect.runPromise(enforceTurnstile(fakeRequest({ [TURNSTILE_RESPONSE_HEADER]: 'ok' })))
  })
})
