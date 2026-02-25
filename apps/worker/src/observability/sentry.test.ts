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

describe('worker sentry wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetWorkerSentryForTest()
  })

  it('skips initialization when DSN is missing', async () => {
    const initialized = await initializeWorkerSentry({
      NODE_ENV: 'development',
      TEMPORAL_RUNTIME_MODE: 'cli',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'tx-agent-kit',
      TEMPORAL_API_KEY: undefined,
      TEMPORAL_TLS_ENABLED: false,
      TEMPORAL_TLS_SERVER_NAME: undefined,
      WORKER_SENTRY_DSN: undefined
    })

    captureWorkerException(new Error('should-not-send'))
    await flushWorkerSentry()

    expect(initialized).toBe(false)
    expect(sentryInitMock).not.toHaveBeenCalled()
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled()
    expect(sentryFlushMock).not.toHaveBeenCalled()
  })

  it('initializes once and captures exceptions when DSN is configured', async () => {
    const firstInitialize = await initializeWorkerSentry({
      NODE_ENV: 'production',
      TEMPORAL_RUNTIME_MODE: 'cloud',
      TEMPORAL_ADDRESS: 'cloud.temporal.io:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'tx-agent-kit',
      TEMPORAL_API_KEY: 'key',
      TEMPORAL_TLS_ENABLED: true,
      TEMPORAL_TLS_SERVER_NAME: undefined,
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/123'
    })
    const secondInitialize = await initializeWorkerSentry({
      NODE_ENV: 'production',
      TEMPORAL_RUNTIME_MODE: 'cloud',
      TEMPORAL_ADDRESS: 'cloud.temporal.io:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'tx-agent-kit',
      TEMPORAL_API_KEY: 'key',
      TEMPORAL_TLS_ENABLED: true,
      TEMPORAL_TLS_SERVER_NAME: undefined,
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
        tracesSampleRate: 0
      })
    )
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1)
    expect(sentryFlushMock).toHaveBeenCalledWith(2_000)
  })
})
