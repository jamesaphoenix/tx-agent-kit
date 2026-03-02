import { beforeEach, describe, expect, it, vi } from 'vitest'

const startTelemetryMock = vi.fn(() => Promise.resolve(undefined))
const stopTelemetryMock = vi.fn(() => Promise.resolve(undefined))
const loggerInfoMock = vi.fn()
const loggerErrorMock = vi.fn()
const initializeWorkerSentryMock = vi.fn()
const captureWorkerExceptionMock = vi.fn()
const flushWorkerSentryMock = vi.fn(() => Promise.resolve(undefined))
const closeConnectionMock = vi.fn(() => Promise.resolve(undefined))
const closeClientConnectionMock = vi.fn(() => Promise.resolve(undefined))
const workerShutdownMock = vi.fn()
const workerRunMock = vi.fn(() => Promise.resolve(undefined))
const nativeConnectionConnectMock = vi.fn(() => Promise.resolve({
  close: closeConnectionMock
}))
const clientConnectionConnectMock = vi.fn(() => Promise.resolve({
  close: closeClientConnectionMock
}))
const workerCreateMock = vi.fn(() => Promise.resolve({
  run: workerRunMock,
  shutdown: workerShutdownMock
}))
const ensureOutboxPollerScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureStuckEventsResetScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensurePrunePublishedScheduleMock = vi.fn(() => Promise.resolve(undefined))

vi.mock('@tx-agent-kit/observability', () => ({
  startTelemetry: startTelemetryMock,
  stopTelemetry: stopTelemetryMock
}))

vi.mock('@tx-agent-kit/logging', () => ({
  createLogger: () => ({
    info: loggerInfoMock,
    error: loggerErrorMock
  })
}))

vi.mock('@temporalio/worker', () => ({
  NativeConnection: {
    connect: nativeConnectionConnectMock
  },
  Worker: {
    create: workerCreateMock
  }
}))

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: clientConnectionConnectMock
  },
  Client: vi.fn()
}))

vi.mock('./activities.js', () => ({
  activities: {}
}))

vi.mock('./schedules.js', () => ({
  ensureOutboxPollerSchedule: ensureOutboxPollerScheduleMock,
  ensureStuckEventsResetSchedule: ensureStuckEventsResetScheduleMock,
  ensurePrunePublishedSchedule: ensurePrunePublishedScheduleMock
}))

vi.mock('./observability/sentry.js', () => ({
  initializeWorkerSentry: initializeWorkerSentryMock,
  captureWorkerException: captureWorkerExceptionMock,
  flushWorkerSentry: flushWorkerSentryMock
}))

vi.mock('./config/env.js', () => ({
  getWorkerEnv: () => ({
    NODE_ENV: 'staging',
    DATABASE_URL: 'postgresql://localhost:5432/test',
    OUTBOX_POLL_BATCH_SIZE: 50,
    OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
    OUTBOX_PRUNE_RETENTION_DAYS: 30,
    TEMPORAL_RUNTIME_MODE: 'cli',
    TEMPORAL_ADDRESS: 'temporal.internal:7233',
    TEMPORAL_NAMESPACE: 'staging',
    TEMPORAL_TASK_QUEUE: 'tx-agent-kit-worker',
    TEMPORAL_API_KEY: undefined,
    TEMPORAL_TLS_ENABLED: false,
    TEMPORAL_TLS_SERVER_NAME: undefined,
    TEMPORAL_TLS_CA_CERT_PEM: undefined,
    TEMPORAL_TLS_CLIENT_CERT_PEM: undefined,
    TEMPORAL_TLS_CLIENT_KEY_PEM: undefined,
    WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/123',
    RESEND_API_KEY: undefined,
    RESEND_FROM_EMAIL: undefined,
    WEB_BASE_URL: undefined
  }),
  resolveWorkerTemporalConnectionOptions: (env: {
    TEMPORAL_ADDRESS: string
  }) => ({
    address: env.TEMPORAL_ADDRESS
  })
}))

describe('worker bootstrap telemetry wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('starts and stops telemetry around worker lifecycle', async () => {
    await import('./index.js')

    await vi.waitFor(() => {
      expect(startTelemetryMock).toHaveBeenCalledWith('tx-agent-kit-worker')
    })

    expect(nativeConnectionConnectMock).toHaveBeenCalledWith({
      address: 'temporal.internal:7233'
    })

    expect(workerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'staging',
        taskQueue: 'tx-agent-kit-worker'
      })
    )

    await vi.waitFor(() => {
      expect(initializeWorkerSentryMock).toHaveBeenCalledTimes(1)
      expect(workerRunMock).toHaveBeenCalledTimes(1)
      expect(closeConnectionMock).toHaveBeenCalledTimes(1)
      expect(stopTelemetryMock).toHaveBeenCalledTimes(1)
      expect(flushWorkerSentryMock).toHaveBeenCalledTimes(1)
      expect(captureWorkerExceptionMock).not.toHaveBeenCalled()
    })
  })

  it('captures unhandled worker errors and flushes sentry', async () => {
    workerRunMock.mockRejectedValueOnce(new Error('worker exploded'))

    await import('./index.js')

    await vi.waitFor(() => {
      expect(captureWorkerExceptionMock).toHaveBeenCalledTimes(1)
      expect(flushWorkerSentryMock).toHaveBeenCalledTimes(1)
      expect(loggerErrorMock).toHaveBeenCalledTimes(1)
    })
  })
})
