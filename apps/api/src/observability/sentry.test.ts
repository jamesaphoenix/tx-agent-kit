import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetApiSentryForTest,
  captureApiException,
  flushApiSentry,
  initializeApiSentry
} from './sentry.js'

// The reporter (init/race/trace/withScope) is tested in
// @tx-agent-kit/observability/sentry; here we mock it and assert the API
// wrapper resolves the right DSN/spotlight and forwards capture/flush/reset.
// The real end-to-end @sentry/node wiring is covered by
// sentry.integration.test.ts.
const { initializeMock, captureExceptionMock, captureScopedMock, flushMock, resetMock } = vi.hoisted(
  () => ({
    initializeMock: vi.fn(() => Promise.resolve(true)),
    captureExceptionMock: vi.fn(),
    captureScopedMock: vi.fn(),
    flushMock: vi.fn(() => Promise.resolve()),
    resetMock: vi.fn()
  })
)

vi.mock('@tx-agent-kit/observability/sentry', () => ({
  SENTRY_SPOTLIGHT_PLACEHOLDER_DSN: 'https://spotlight@local/0',
  createSentryReporter: () => ({
    initialize: initializeMock,
    captureException: captureExceptionMock,
    captureScoped: captureScopedMock,
    flush: flushMock,
    reset: resetMock
  })
}))

const baseApiEnv = {
  NODE_ENV: 'development',
  API_PORT: '4000',
  API_HOST: '0.0.0.0',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  API_CORS_ORIGIN: 'http://localhost:3000',
  API_SENTRY_DSN: undefined as string | undefined,
  SENTRY_SPOTLIGHT: undefined as string | undefined
}

describe('api sentry wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes no DSN (spotlight off) so the reporter skips init', async () => {
    await initializeApiSentry(baseApiEnv)

    expect(initializeMock).toHaveBeenCalledWith({
      dsn: undefined,
      environment: 'development',
      spotlightEnabled: false,
      component: 'api'
    })
  })

  it('resolves API_SENTRY_DSN and tags component=api', async () => {
    await initializeApiSentry({
      ...baseApiEnv,
      NODE_ENV: 'production',
      API_SENTRY_DSN: 'https://api@sentry.example.com/123'
    })

    expect(initializeMock).toHaveBeenCalledWith({
      dsn: 'https://api@sentry.example.com/123',
      environment: 'production',
      spotlightEnabled: false,
      component: 'api'
    })
  })

  it('uses the spotlight placeholder DSN when SENTRY_SPOTLIGHT=true and no real DSN', async () => {
    await initializeApiSentry({ ...baseApiEnv, SENTRY_SPOTLIGHT: 'true' })

    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://spotlight@local/0', spotlightEnabled: true })
    )
  })

  it('treats SENTRY_SPOTLIGHT=1 as truthy and prefers a real DSN when both are set', async () => {
    await initializeApiSentry({
      ...baseApiEnv,
      API_SENTRY_DSN: 'https://api@sentry.example.com/123',
      SENTRY_SPOTLIGHT: '1'
    })

    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://api@sentry.example.com/123', spotlightEnabled: true })
    )
  })

  it('treats SENTRY_SPOTLIGHT=false as off (no DSN, no init)', async () => {
    await initializeApiSentry({ ...baseApiEnv, SENTRY_SPOTLIGHT: 'false' })

    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: undefined, spotlightEnabled: false })
    )
  })

  it('forwards process-level exceptions to the reporter', () => {
    captureApiException(new Error('boom'))
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
  })

  it('flushes and resets through the reporter', async () => {
    await flushApiSentry()
    _resetApiSentryForTest()

    expect(flushMock).toHaveBeenCalledWith(2000)
    expect(resetMock).toHaveBeenCalledTimes(1)
  })
})
