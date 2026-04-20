import { beforeEach, describe, expect, it, vi } from 'vitest'

const startTelemetryMock = vi.fn(() => Promise.resolve(undefined))
const stopTelemetryMock = vi.fn(() => Promise.resolve(undefined))
const loggerInfoMock = vi.fn()
const loggerWarnMock = vi.fn()
const loggerErrorMock = vi.fn()
const initializeWorkerSentryMock = vi.fn()
const captureWorkerExceptionMock = vi.fn()
const flushWorkerSentryMock = vi.fn(() => Promise.resolve(undefined))
const closeConnectionMock = vi.fn(() => Promise.resolve(undefined))
const closeClientConnectionMock = vi.fn(() => Promise.resolve(undefined))
const workerShutdownMock = vi.fn()
const workerGetStateMock = vi.fn(() => 'RUNNING')
const workerRunMock = vi.fn(() => Promise.resolve(undefined))
const nativeConnectionConnectMock = vi.fn(() => Promise.resolve({
  close: closeConnectionMock
}))
const clientConnectionConnectMock = vi.fn(() => Promise.resolve({
  close: closeClientConnectionMock
}))
const workerCreateMock = vi.fn(() => Promise.resolve({
  getState: workerGetStateMock,
  run: workerRunMock,
  shutdown: workerShutdownMock
}))
const ensureOutboxPollerScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureStuckEventsResetScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensurePrunePublishedScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureRetentionCleanerScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureReleaseStaleReservationsScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureAutoRechargeRetryScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureStorageReconcileScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureEmailSendsPruneScheduleMock = vi.fn(() => Promise.resolve(undefined))
const defaultWorkerEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  WORKER_ENABLE_SCHEDULES: true,
  OUTBOX_POLL_BATCH_SIZE: 50,
  OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
  OUTBOX_PRUNE_RETENTION_DAYS: 30,
  RESERVATION_RECLAIM_MAX_AGE_SECONDS: 7200,
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
  SENTRY_SPOTLIGHT: false,
  RESEND_API_KEY: undefined,
  RESEND_FROM_EMAIL: undefined,
  WEB_BASE_URL: undefined,
  EMAIL_CAMPAIGNS_TASK_QUEUE: 'email-campaigns',
  STRIPE_SECRET_KEY: undefined
}
const getWorkerEnvMock = vi.fn(() => ({ ...defaultWorkerEnv }))

vi.mock('@tx-agent-kit/observability', () => ({
  startTelemetry: startTelemetryMock,
  stopTelemetry: stopTelemetryMock
}))

vi.mock('@tx-agent-kit/logging', () => ({
  createLogger: () => ({
    info: loggerInfoMock,
    warn: loggerWarnMock,
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
  activities: {},
  storageActivities: {},
  billingActivities: {},
  combinedActivities: {}
}))

vi.mock('./campaign-activities.js', () => ({
  campaignActivities: {}
}))

vi.mock('./schedules.js', () => ({
  ensureOutboxPollerSchedule: ensureOutboxPollerScheduleMock,
  ensureStuckEventsResetSchedule: ensureStuckEventsResetScheduleMock,
  ensurePrunePublishedSchedule: ensurePrunePublishedScheduleMock,
  ensureRetentionCleanerSchedule: ensureRetentionCleanerScheduleMock,
  ensureReleaseStaleReservationsSchedule: ensureReleaseStaleReservationsScheduleMock,
  ensureAutoRechargeRetrySchedule: ensureAutoRechargeRetryScheduleMock,
  ensureStorageReconcileSchedule: ensureStorageReconcileScheduleMock
}))

vi.mock('./campaign-schedules.js', () => ({
  ensureEmailSendsPruneSchedule: ensureEmailSendsPruneScheduleMock
}))

vi.mock('./observability/sentry.js', () => ({
  initializeWorkerSentry: initializeWorkerSentryMock,
  captureWorkerException: captureWorkerExceptionMock,
  flushWorkerSentry: flushWorkerSentryMock
}))

vi.mock('./config/env.js', () => ({
  getWorkerEnv: getWorkerEnvMock,
  resolveWorkerTemporalConnectionOptions: (env: {
    TEMPORAL_ADDRESS: string
  }) => ({
    address: env.TEMPORAL_ADDRESS
  })
}))

describe('worker bootstrap telemetry wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getWorkerEnvMock.mockReturnValue({ ...defaultWorkerEnv })
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
        taskQueue: 'tx-agent-kit-worker',
        maxConcurrentWorkflowTaskPolls: 1,
        maxConcurrentActivityTaskPolls: 1
      })
    )

    expect(workerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'staging',
        taskQueue: 'email-campaigns',
        maxConcurrentWorkflowTaskPolls: 1,
        maxConcurrentActivityTaskPolls: 1
      })
    )

    await vi.waitFor(() => {
      expect(initializeWorkerSentryMock).toHaveBeenCalledTimes(1)
      expect(workerRunMock).toHaveBeenCalledTimes(2)
      expect(closeConnectionMock).toHaveBeenCalledTimes(1)
      expect(stopTelemetryMock).toHaveBeenCalledTimes(1)
      expect(flushWorkerSentryMock).toHaveBeenCalledTimes(1)
      expect(captureWorkerExceptionMock).not.toHaveBeenCalled()
    })

    expect(workerRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      ensureOutboxPollerScheduleMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
  })

  it('skips schedule reconciliation when worker schedules are disabled', async () => {
    getWorkerEnvMock.mockReturnValue({
      ...defaultWorkerEnv,
      WORKER_ENABLE_SCHEDULES: false
    })

    await import('./index.js')

    await vi.waitFor(() => {
      expect(workerRunMock).toHaveBeenCalledTimes(2)
      expect(closeConnectionMock).toHaveBeenCalledTimes(1)
      expect(stopTelemetryMock).toHaveBeenCalledTimes(1)
    })

    expect(ensureOutboxPollerScheduleMock).not.toHaveBeenCalled()
    expect(ensureStuckEventsResetScheduleMock).not.toHaveBeenCalled()
    expect(ensurePrunePublishedScheduleMock).not.toHaveBeenCalled()
    expect(ensureRetentionCleanerScheduleMock).not.toHaveBeenCalled()
    expect(ensureReleaseStaleReservationsScheduleMock).not.toHaveBeenCalled()
    expect(ensureAutoRechargeRetryScheduleMock).not.toHaveBeenCalled()
    expect(ensureStorageReconcileScheduleMock).not.toHaveBeenCalled()
    expect(ensureEmailSendsPruneScheduleMock).not.toHaveBeenCalled()
    expect(loggerInfoMock).toHaveBeenCalledWith(
      'Temporal schedule reconciliation skipped.',
      { nodeEnv: 'test' }
    )
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
