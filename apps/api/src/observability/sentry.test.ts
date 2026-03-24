import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetApiSentryForTest,
  captureApiException,
  flushApiSentry,
  initializeApiSentry
} from './sentry.js'

const { sentryCaptureExceptionMock, sentryFlushMock, sentryInitMock } = vi.hoisted(() => ({
  sentryCaptureExceptionMock: vi.fn(),
  sentryFlushMock: vi.fn(() => Promise.resolve(true)),
  sentryInitMock: vi.fn()
}))

vi.mock('@sentry/node', () => ({
  init: sentryInitMock,
  captureException: sentryCaptureExceptionMock,
  flush: sentryFlushMock
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

describe('api sentry wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetApiSentryForTest()
  })

  it('skips initialization when DSN is missing and spotlight is off', async () => {
    const initialized = await initializeApiSentry(baseApiEnv)

    captureApiException(new Error('should-not-send'))
    await flushApiSentry()

    expect(initialized).toBe(false)
    expect(sentryInitMock).not.toHaveBeenCalled()
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled()
    expect(sentryFlushMock).not.toHaveBeenCalled()
  })

  it('initializes once and captures exceptions when DSN is configured', async () => {
    const firstInitialize = await initializeApiSentry({
      ...baseApiEnv,
      NODE_ENV: 'production',
      API_SENTRY_DSN: 'https://api@sentry.example.com/123'
    })
    const secondInitialize = await initializeApiSentry({
      ...baseApiEnv,
      NODE_ENV: 'production',
      API_SENTRY_DSN: 'https://api@sentry.example.com/123'
    })

    captureApiException(new Error('boom'))
    await flushApiSentry()

    expect(firstInitialize).toBe(true)
    expect(secondInitialize).toBe(false)
    expect(sentryInitMock).toHaveBeenCalledTimes(1)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://api@sentry.example.com/123',
        environment: 'production',
        tracesSampleRate: 0,
        spotlight: false
      })
    )
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1)
    expect(sentryFlushMock).toHaveBeenCalledWith(2000)
  })

  it('initializes with spotlight when SENTRY_SPOTLIGHT is true and no DSN', async () => {
    const initialized = await initializeApiSentry({
      ...baseApiEnv,
      SENTRY_SPOTLIGHT: 'true'
    })

    expect(initialized).toBe(true)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://spotlight@local/0',
        tracesSampleRate: 1.0,
        spotlight: true
      })
    )
  })

  it('initializes with spotlight and real DSN when both are configured', async () => {
    const initialized = await initializeApiSentry({
      ...baseApiEnv,
      API_SENTRY_DSN: 'https://api@sentry.example.com/123',
      SENTRY_SPOTLIGHT: 'true'
    })

    expect(initialized).toBe(true)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://api@sentry.example.com/123',
        tracesSampleRate: 1.0,
        spotlight: true
      })
    )
  })

  it('treats SENTRY_SPOTLIGHT=1 as truthy', async () => {
    const initialized = await initializeApiSentry({
      ...baseApiEnv,
      SENTRY_SPOTLIGHT: '1'
    })

    expect(initialized).toBe(true)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spotlight: true
      })
    )
  })

  it('skips when spotlight is false and no DSN', async () => {
    const initialized = await initializeApiSentry({
      ...baseApiEnv,
      SENTRY_SPOTLIGHT: 'false'
    })

    expect(initialized).toBe(false)
    expect(sentryInitMock).not.toHaveBeenCalled()
  })
})
