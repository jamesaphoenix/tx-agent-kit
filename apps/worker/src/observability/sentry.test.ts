import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetWorkerSentryForTest,
  captureWorkerException,
  flushWorkerSentry,
  initializeWorkerSentry
} from './sentry.js'

// The reporter (init/race/trace/withScope) is tested in
// @tx-agent-kit/observability/sentry; here we mock it and assert the worker
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

const baseEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  WORKER_ENABLE_SCHEDULES: true,
  OUTBOX_POLL_BATCH_SIZE: 50,
  OUTBOX_BACKSTOP_INTERVAL_SECONDS: 10,
  OUTBOX_LISTENER_DATABASE_URL: 'postgresql://localhost:5432/test',
  OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
  OUTBOX_PRUNE_RETENTION_DAYS: 30,
  RESERVATION_RECLAIM_MAX_AGE_SECONDS: 7200,
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
  WEB_BASE_URL: undefined,
  EMAIL_CAMPAIGNS_TASK_QUEUE: 'email-campaigns',
  DRIP_SWEEP_INTERVAL_MINUTES: 5,
  DRIP_SWEEP_BATCH_SIZE: 100,
  DRIP_SWEEP_MAX_BATCHES: 50,
  LIFECYCLE_SCAN_INTERVAL_HOURS: 24,
  STRIPE_SECRET_KEY: undefined
}

describe('worker sentry wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes no DSN (spotlight off) so the reporter skips init', async () => {
    await initializeWorkerSentry(baseEnv)

    expect(initializeMock).toHaveBeenCalledWith({
      dsn: undefined,
      environment: 'development',
      spotlightEnabled: false,
      component: 'worker'
    })
  })

  it('resolves WORKER_SENTRY_DSN and tags component=worker', async () => {
    await initializeWorkerSentry({
      ...baseEnv,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      TEMPORAL_RUNTIME_MODE: 'cloud',
      TEMPORAL_ADDRESS: 'cloud.temporal.io:7233',
      TEMPORAL_API_KEY: 'key',
      TEMPORAL_TLS_ENABLED: true,
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/123'
    })

    expect(initializeMock).toHaveBeenCalledWith({
      dsn: 'https://worker@sentry.example.com/123',
      environment: 'production',
      spotlightEnabled: false,
      component: 'worker'
    })
  })

  it('uses the spotlight placeholder DSN when SENTRY_SPOTLIGHT=true and no real DSN', async () => {
    await initializeWorkerSentry({ ...baseEnv, SENTRY_SPOTLIGHT: true })

    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://spotlight@local/0', spotlightEnabled: true })
    )
  })

  it('prefers a real DSN over the spotlight placeholder when both are set', async () => {
    await initializeWorkerSentry({
      ...baseEnv,
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/123',
      SENTRY_SPOTLIGHT: true
    })

    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://worker@sentry.example.com/123',
        spotlightEnabled: true
      })
    )
  })

  it('forwards process-level exceptions to the reporter', () => {
    captureWorkerException(new Error('boom'))
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
  })

  it('flushes and resets through the reporter', async () => {
    await flushWorkerSentry()
    _resetWorkerSentryForTest()

    expect(flushMock).toHaveBeenCalledWith(2000)
    expect(resetMock).toHaveBeenCalledTimes(1)
  })
})
