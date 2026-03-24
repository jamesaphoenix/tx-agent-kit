import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetWorkerSentryForTest,
  captureWorkerException,
  flushWorkerSentry,
  initializeWorkerSentry
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

const baseEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  OUTBOX_POLL_BATCH_SIZE: 50,
  OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
  OUTBOX_PRUNE_RETENTION_DAYS: 30,
  TEMPORAL_RUNTIME_MODE: 'cli' as const,
  TEMPORAL_ADDRESS: 'localhost:7233',
  TEMPORAL_NAMESPACE: 'default',
  TEMPORAL_TASK_QUEUE: 'tx-agent-kit',
  TEMPORAL_API_KEY: undefined,
  TEMPORAL_TLS_ENABLED: false,
  TEMPORAL_TLS_SERVER_NAME: undefined,
  TEMPORAL_TLS_CA_CERT_PEM: undefined,
  TEMPORAL_TLS_CLIENT_CERT_PEM: undefined,
  TEMPORAL_TLS_CLIENT_KEY_PEM: undefined,
  WORKER_SENTRY_DSN: undefined,
  SENTRY_SPOTLIGHT: false,
  RESEND_API_KEY: undefined,
  RESEND_FROM_EMAIL: undefined,
  WEB_BASE_URL: undefined
}

describe('worker sentry wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetWorkerSentryForTest()
  })

  it('skips initialization when DSN is missing and spotlight is off', async () => {
    const initialized = await initializeWorkerSentry(baseEnv)

    captureWorkerException(new Error('should-not-send'))
    await flushWorkerSentry()

    expect(initialized).toBe(false)
    expect(sentryInitMock).not.toHaveBeenCalled()
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled()
    expect(sentryFlushMock).not.toHaveBeenCalled()
  })

  it('initializes once and captures exceptions when DSN is configured', async () => {
    const firstInitialize = await initializeWorkerSentry({
      ...baseEnv,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      TEMPORAL_RUNTIME_MODE: 'cloud',
      TEMPORAL_ADDRESS: 'cloud.temporal.io:7233',
      TEMPORAL_API_KEY: 'key',
      TEMPORAL_TLS_ENABLED: true,
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/123'
    })
    const secondInitialize = await initializeWorkerSentry({
      ...baseEnv,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      TEMPORAL_RUNTIME_MODE: 'cloud',
      TEMPORAL_ADDRESS: 'cloud.temporal.io:7233',
      TEMPORAL_API_KEY: 'key',
      TEMPORAL_TLS_ENABLED: true,
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/123'
    })

    captureWorkerException(new Error('boom'))
    await flushWorkerSentry()

    expect(firstInitialize).toBe(true)
    expect(secondInitialize).toBe(false)
    expect(sentryInitMock).toHaveBeenCalledTimes(1)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://worker@sentry.example.com/123',
        environment: 'production',
        tracesSampleRate: 0,
        spotlight: false
      })
    )
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1)
    expect(sentryFlushMock).toHaveBeenCalledWith(2000)
  })

  it('initializes with spotlight when SENTRY_SPOTLIGHT is true and no DSN', async () => {
    const initialized = await initializeWorkerSentry({
      ...baseEnv,
      SENTRY_SPOTLIGHT: true
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
    const initialized = await initializeWorkerSentry({
      ...baseEnv,
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/123',
      SENTRY_SPOTLIGHT: true
    })

    expect(initialized).toBe(true)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://worker@sentry.example.com/123',
        tracesSampleRate: 1.0,
        spotlight: true
      })
    )
  })
})
