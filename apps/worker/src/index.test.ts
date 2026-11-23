import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type * as WorkerResiliencePolicy from './worker-resilience-policy.js'

// Asymmetric matchers are typed `any`; nested in object literals they trip
// no-unsafe-assignment, so nest them through these `unknown`-typed wrappers.
const stringContaining = (text: string): unknown => expect.stringContaining(text)
const objectContaining = (shape: Record<string, unknown>): unknown => expect.objectContaining(shape)
const anything = (): unknown => expect.anything()

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
const setPoolErrorReporterMock = vi.fn()
const closeRedisClientsMock = vi.fn(() => Promise.resolve(undefined))
const setRedisErrorReporterMock = vi.fn()
const workerShutdownMock = vi.fn()
// Like the real SDK, a worker's run() only settles once it is shut down (or
// fails). A test overrides one run with mockRejectedValueOnce/mockResolvedValueOnce.
const workerRunMock = vi.fn((): Promise<void> | undefined => undefined)
const describeNamespaceMock = vi.fn(() => Promise.resolve({}))
const createNativeConnection = () => ({
  close: closeConnectionMock,
  workflowService: { describeNamespace: describeNamespaceMock }
})
const nativeConnectionConnectMock = vi.fn(() => Promise.resolve(createNativeConnection()))
const clientConnectionConnectMock = vi.fn(() => Promise.resolve({
  close: closeClientConnectionMock
}))
const createWorkerHandle = () => {
  let resolveRun: () => void = () => undefined
  const untilShutdown = new Promise<void>((resolve) => {
    resolveRun = resolve
  })
  let state = 'RUNNING'
  return {
    getState: () => state,
    run: () => workerRunMock() ?? untilShutdown,
    shutdown: () => {
      workerShutdownMock()
      state = 'STOPPING'
      resolveRun()
    }
  }
}
const workerCreateMock = vi.fn(() => Promise.resolve(createWorkerHandle()))
const deleteOutboxPollerScheduleIfExistsMock = vi.fn(() => Promise.resolve(undefined))
const outboxDispatcherStopMock = vi.fn(() => Promise.resolve(undefined))
const startOutboxDispatcherMock = vi.fn(() => ({
  drain: vi.fn(() => Promise.resolve(undefined)),
  stop: outboxDispatcherStopMock
}))
const ensureStuckEventsResetScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensurePrunePublishedScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureRetentionCleanerScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureReleaseStaleReservationsScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureAutoRechargeRetryScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureStorageReconcileScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureEmailSendsPruneScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureDripSweepScheduleMock = vi.fn(() => Promise.resolve(undefined))
const ensureLifecycleScanScheduleMock = vi.fn(() => Promise.resolve(undefined))
const syncCampaignDefinitionsMock = vi.fn(() => Promise.resolve(undefined))
const defaultWorkerEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  WORKER_ENABLE_SCHEDULES: true,
  OUTBOX_POLL_BATCH_SIZE: 50,
  OUTBOX_BACKSTOP_INTERVAL_SECONDS: 10,
  OUTBOX_LISTENER_DATABASE_URL: 'postgresql://localhost:5432/test',
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
  DRIP_SWEEP_INTERVAL_MINUTES: 5,
  DRIP_SWEEP_BATCH_SIZE: 100,
  DRIP_SWEEP_MAX_BATCHES: 50,
  LIFECYCLE_SCAN_INTERVAL_HOURS: 24,
  STRIPE_SECRET_KEY: undefined
}
const getWorkerEnvMock = vi.fn(() => ({ ...defaultWorkerEnv }))

vi.mock('@tx-agent-kit/observability', () => ({
  startTelemetry: startTelemetryMock,
  stopTelemetry: stopTelemetryMock
}))

// Mocked so the first import does not cold-load the real pg/ioredis graphs,
// which under parallel load could exceed the test timeout.
vi.mock('@tx-agent-kit/db', () => ({
  setPoolErrorReporter: setPoolErrorReporterMock
}))

vi.mock('@tx-agent-kit/redis', () => ({
  closeRedisClients: closeRedisClientsMock,
  setRedisErrorReporter: setRedisErrorReporterMock
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
  deleteOutboxPollerScheduleIfExists: deleteOutboxPollerScheduleIfExistsMock,
  ensureStuckEventsResetSchedule: ensureStuckEventsResetScheduleMock,
  ensurePrunePublishedSchedule: ensurePrunePublishedScheduleMock,
  ensureRetentionCleanerSchedule: ensureRetentionCleanerScheduleMock,
  ensureReleaseStaleReservationsSchedule: ensureReleaseStaleReservationsScheduleMock,
  ensureAutoRechargeRetrySchedule: ensureAutoRechargeRetryScheduleMock,
  ensureStorageReconcileSchedule: ensureStorageReconcileScheduleMock
}))

vi.mock('./schedules/index.js', () => ({
  ensureEmailSendsPruneSchedule: ensureEmailSendsPruneScheduleMock,
  ensureDripSweepSchedule: ensureDripSweepScheduleMock,
  ensureLifecycleScanSchedule: ensureLifecycleScanScheduleMock
}))

vi.mock('./campaign-definition-sync.js', () => ({
  syncCampaignDefinitions: syncCampaignDefinitionsMock
}))

vi.mock('./dispatch/outbox-dispatcher.js', () => ({
  startOutboxDispatcher: startOutboxDispatcherMock
}))

vi.mock('./observability/sentry.js', () => ({
  initializeWorkerSentry: initializeWorkerSentryMock,
  captureWorkerException: captureWorkerExceptionMock,
  flushWorkerSentry: flushWorkerSentryMock
}))

// Millisecond-scale retry timings so the resilience paths run in real time.
vi.mock('./worker-resilience-policy.js', async (importOriginal) => ({
  ...await importOriginal<typeof WorkerResiliencePolicy>(),
  TEMPORAL_STARTUP_RETRY: {
    policy: { initialDelayMs: 1, maxDelayMs: 4, multiplier: 2, jitterRatio: 0 },
    escalateAfterMs: 10_000,
    maxElapsedMs: 150
  },
  BACKGROUND_RECONCILE_RETRY: {
    policy: { initialDelayMs: 1, maxDelayMs: 4, multiplier: 2, jitterRatio: 0 },
    escalateAfterMs: 10_000
  },
  WORKER_EXIT_BACKSTOP_MS: 10_000
}))

vi.mock('./config/env.js', () => ({
  getWorkerEnv: getWorkerEnvMock,
  resolveWorkerTemporalConnectionOptions: (env: {
    TEMPORAL_ADDRESS: string
  }) => ({
    address: env.TEMPORAL_ADDRESS
  })
}))

let processExitSpy: MockInstance<typeof process.exit>
let processOnceSpy: MockInstance
const previousExitCode = process.exitCode

/** The SIGTERM handler the worker registered once its pollers started. */
const registeredSigtermHandler = (): (() => void) | undefined => {
  const call = processOnceSpy.mock.calls.find(([event]) => event === 'SIGTERM')
  return call?.[1] as (() => void) | undefined
}

/** Wait for the workers to start, then deliver SIGTERM the way Docker would. */
const sendSigtermOnceStarted = async (): Promise<void> => {
  await vi.waitFor(() => {
    expect(registeredSigtermHandler()).toBeTypeOf('function')
  })
  registeredSigtermHandler()?.()
}

const waitForReconciliationComplete = async (): Promise<void> => {
  await vi.waitFor(() => {
    expect(loggerInfoMock).toHaveBeenCalledWith('Temporal schedule reconciliation complete.', expect.anything())
  })
}

const waitForExit = async (code: number): Promise<void> => {
  await vi.waitFor(() => {
    expect(processExitSpy).toHaveBeenCalledWith(code)
  })
}

const setUpWorkerProcess = () => {
  vi.clearAllMocks()
  getWorkerEnvMock.mockReturnValue({ ...defaultWorkerEnv })
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  processOnceSpy = vi.spyOn(process, 'once')
  vi.resetModules()
}

const tearDownWorkerProcess = () => {
  // Detach anything a test left registered so a stray signal cannot reach it.
  const handler = registeredSigtermHandler()
  if (handler) {
    process.off('SIGTERM', handler)
  }
  processExitSpy.mockRestore()
  processOnceSpy.mockRestore()
  process.exitCode = previousExitCode
}

describe('worker bootstrap telemetry wiring', () => {
  beforeEach(setUpWorkerProcess)
  afterEach(tearDownWorkerProcess)

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

    await waitForReconciliationComplete()
    await sendSigtermOnceStarted()
    await waitForExit(0)

    await vi.waitFor(() => {
      expect(initializeWorkerSentryMock).toHaveBeenCalledTimes(1)
      expect(workerRunMock).toHaveBeenCalledTimes(2)
      expect(closeConnectionMock).toHaveBeenCalledTimes(1)
      expect(stopTelemetryMock).toHaveBeenCalledTimes(1)
      expect(flushWorkerSentryMock).toHaveBeenCalledTimes(1)
      expect(captureWorkerExceptionMock).not.toHaveBeenCalled()
    })

    expect(startOutboxDispatcherMock).toHaveBeenCalledTimes(1)
    expect(deleteOutboxPollerScheduleIfExistsMock).toHaveBeenCalledTimes(1)
    expect(workerRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteOutboxPollerScheduleIfExistsMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
  })

  it('skips schedule reconciliation when worker schedules are disabled', async () => {
    getWorkerEnvMock.mockReturnValue({
      ...defaultWorkerEnv,
      WORKER_ENABLE_SCHEDULES: false
    })

    await import('./index.js')
    await sendSigtermOnceStarted()

    await vi.waitFor(() => {
      expect(workerRunMock).toHaveBeenCalledTimes(2)
      expect(closeConnectionMock).toHaveBeenCalledTimes(1)
      expect(stopTelemetryMock).toHaveBeenCalledTimes(1)
    })
    await waitForExit(0)
    // No schedules to reconcile means no schedule client to connect either.
    expect(clientConnectionConnectMock).not.toHaveBeenCalled()

    expect(deleteOutboxPollerScheduleIfExistsMock).not.toHaveBeenCalled()
    expect(startOutboxDispatcherMock).not.toHaveBeenCalled()
    expect(ensureStuckEventsResetScheduleMock).not.toHaveBeenCalled()
    expect(ensurePrunePublishedScheduleMock).not.toHaveBeenCalled()
    expect(ensureRetentionCleanerScheduleMock).not.toHaveBeenCalled()
    expect(ensureReleaseStaleReservationsScheduleMock).not.toHaveBeenCalled()
    expect(ensureAutoRechargeRetryScheduleMock).not.toHaveBeenCalled()
    expect(ensureStorageReconcileScheduleMock).not.toHaveBeenCalled()
    expect(ensureEmailSendsPruneScheduleMock).not.toHaveBeenCalled()
    expect(syncCampaignDefinitionsMock).not.toHaveBeenCalled()
    expect(ensureDripSweepScheduleMock).not.toHaveBeenCalled()
    expect(ensureLifecycleScanScheduleMock).not.toHaveBeenCalled()
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
    await waitForExit(1)
  })
})

describe('worker survives a Temporal outage', () => {
  beforeEach(setUpWorkerProcess)
  afterEach(tearDownWorkerProcess)

  const namespaceUnavailable = () => new Error(
    'Namespace production was not found or otherwise could not be described: Status { code: Unavailable, message: "GetNamespace operation failed. Error no usable database connection found" }'
  )
  const describeScheduleDeadline = () => new Error('Failed to describe schedule: 4 DEADLINE_EXCEEDED: Deadline exceeded')

  it('exits non-zero (no zombie) when a worker run fails, shutting the other worker down first', async () => {
    workerRunMock.mockRejectedValueOnce(namespaceUnavailable())

    await import('./index.js')
    await waitForExit(1)

    expect(workerShutdownMock).toHaveBeenCalled()
    expect(closeConnectionMock).toHaveBeenCalledTimes(1)
    expect(captureWorkerExceptionMock).toHaveBeenCalledTimes(1)
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Temporal worker stopped due to an unhandled error.',
      { error: objectContaining({ message: stringContaining('could not be described') }) }
    )
    expect(processExitSpy).not.toHaveBeenCalledWith(0)
  })

  it('exits non-zero when one worker stops on its own while the other is still polling', async () => {
    workerRunMock.mockResolvedValueOnce(undefined)

    await import('./index.js')
    await waitForExit(1)

    // The worker that was still polling is shut down rather than left running alone.
    expect(workerShutdownMock).toHaveBeenCalled()
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Temporal worker stopped due to an unhandled error.',
      { error: objectContaining({ message: stringContaining('stopped without a shutdown request') }) }
    )
  })

  it('exits 0 after SIGTERM once both workers have drained', async () => {
    await import('./index.js')
    await waitForReconciliationComplete()
    await sendSigtermOnceStarted()
    await waitForExit(0)

    expect(workerShutdownMock).toHaveBeenCalledTimes(2)
    expect(processExitSpy).not.toHaveBeenCalledWith(1)
    expect(captureWorkerExceptionMock).not.toHaveBeenCalled()
  })

  it('retries connecting to Temporal with backoff instead of dying on the first failure', async () => {
    nativeConnectionConnectMock
      .mockRejectedValueOnce(new Error('14 UNAVAILABLE: connection refused'))
      .mockRejectedValueOnce(new Error('14 UNAVAILABLE: connection refused'))

    await import('./index.js')
    await waitForReconciliationComplete()

    expect(nativeConnectionConnectMock).toHaveBeenCalledTimes(3)
    expect(workerCreateMock).toHaveBeenCalledTimes(2)
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Temporal startup (connect and describe namespace) failed; retrying with backoff.',
      expect.objectContaining({ attempt: 1, error: stringContaining('UNAVAILABLE') })
    )
    expect(processExitSpy).not.toHaveBeenCalled()

    await sendSigtermOnceStarted()
    await waitForExit(0)
  })

  it('retries the namespace check on the same connection until the namespace can be described', async () => {
    describeNamespaceMock
      .mockRejectedValueOnce(namespaceUnavailable())
      .mockRejectedValueOnce(namespaceUnavailable())

    await import('./index.js')
    await waitForReconciliationComplete()

    expect(nativeConnectionConnectMock).toHaveBeenCalledTimes(1)
    expect(describeNamespaceMock).toHaveBeenCalledTimes(3)
    expect(describeNamespaceMock).toHaveBeenCalledWith({ namespace: 'staging' })
    // Workers (and their workflow bundles) are only built once the namespace answers.
    expect(workerCreateMock).toHaveBeenCalledTimes(2)
    expect(describeNamespaceMock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      workerCreateMock.mock.invocationCallOrder[0] ?? 0
    )

    await sendSigtermOnceStarted()
    await waitForExit(0)
  })

  it('gives up and exits 1 once Temporal stays unreachable past the startup budget', async () => {
    nativeConnectionConnectMock.mockRejectedValue(new Error('14 UNAVAILABLE: connection refused'))

    try {
      await import('./index.js')
      await waitForExit(1)

      expect(nativeConnectionConnectMock.mock.calls.length).toBeGreaterThan(2)
      expect(workerCreateMock).not.toHaveBeenCalled()
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Temporal worker stopped due to an unhandled error.',
        { error: objectContaining({ message: stringContaining('UNAVAILABLE') }) }
      )
    } finally {
      nativeConnectionConnectMock.mockImplementation(() => Promise.resolve(createNativeConnection()))
    }
  })

  it('fails fast (no retry) when worker creation fails for a reason retrying cannot fix', async () => {
    workerCreateMock.mockRejectedValueOnce(new Error('Webpack finished with errors'))

    await import('./index.js')
    await waitForExit(1)

    expect(workerCreateMock).toHaveBeenCalledTimes(1)
    expect(closeConnectionMock).toHaveBeenCalledTimes(1)
  })

  it('retries worker creation while Temporal is still flaky after the namespace answered', async () => {
    workerCreateMock.mockRejectedValueOnce(Object.assign(new Error('14 UNAVAILABLE'), { name: 'TransportError' }))

    await import('./index.js')
    await waitForReconciliationComplete()

    expect(workerCreateMock).toHaveBeenCalledTimes(3)
    expect(processExitSpy).not.toHaveBeenCalled()

    await sendSigtermOnceStarted()
    await waitForExit(0)
  })

  it('keeps polling when schedule reconciliation hits DEADLINE_EXCEEDED, and retries it in the background', async () => {
    ensureEmailSendsPruneScheduleMock
      .mockRejectedValueOnce(describeScheduleDeadline())
      .mockRejectedValueOnce(describeScheduleDeadline())

    await import('./index.js')
    await waitForReconciliationComplete()

    expect(ensureEmailSendsPruneScheduleMock).toHaveBeenCalledTimes(3)
    // A failing step does not block the steps after it, and succeeded steps are not re-run.
    expect(ensureLifecycleScanScheduleMock).toHaveBeenCalledTimes(1)
    expect(ensureStuckEventsResetScheduleMock).toHaveBeenCalledTimes(1)
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Temporal schedule reconciliation failed; retrying with backoff.',
      expect.objectContaining({
        failedSteps: ['email-sends-prune-schedule'],
        error: stringContaining('DEADLINE_EXCEEDED')
      })
    )
    // Transient: no crash, no Sentry issue, workers never stopped.
    expect(workerShutdownMock).not.toHaveBeenCalled()
    expect(processExitSpy).not.toHaveBeenCalled()
    expect(captureWorkerExceptionMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).not.toHaveBeenCalled()

    await sendSigtermOnceStarted()
    await waitForExit(0)
  })

  it('starts polling before the schedule client connects, and starts the outbox dispatcher once it does', async () => {
    clientConnectionConnectMock
      .mockRejectedValueOnce(new Error('4 DEADLINE_EXCEEDED'))
      .mockRejectedValueOnce(new Error('4 DEADLINE_EXCEEDED'))

    await import('./index.js')
    await waitForReconciliationComplete()

    expect(clientConnectionConnectMock).toHaveBeenCalledTimes(3)
    expect(workerRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      clientConnectionConnectMock.mock.invocationCallOrder[0] ?? 0
    )
    expect(startOutboxDispatcherMock).toHaveBeenCalledTimes(1)
    expect(processExitSpy).not.toHaveBeenCalled()

    await sendSigtermOnceStarted()
    await waitForExit(0)
    expect(outboxDispatcherStopMock).toHaveBeenCalledTimes(1)
    expect(closeClientConnectionMock).toHaveBeenCalledTimes(1)
  })

  it('retries the campaign definition sync in the background instead of failing the boot', async () => {
    syncCampaignDefinitionsMock.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))

    await import('./index.js')
    await waitForReconciliationComplete()

    expect(syncCampaignDefinitionsMock).toHaveBeenCalledTimes(2)
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Temporal schedule reconciliation failed; retrying with backoff.',
      expect.objectContaining({ attempt: 1, failedSteps: ['campaign-definitions-sync'] })
    )
    expect(processExitSpy).not.toHaveBeenCalled()

    await sendSigtermOnceStarted()
    await waitForExit(0)
  })

  it('reconciles every schedule with unchanged definitions', async () => {
    await import('./index.js')
    await waitForReconciliationComplete()

    expect(deleteOutboxPollerScheduleIfExistsMock).toHaveBeenCalledTimes(1)
    expect(ensureStuckEventsResetScheduleMock).toHaveBeenCalledWith(expect.anything(), 'tx-agent-kit-worker', 120, 5)
    expect(ensurePrunePublishedScheduleMock).toHaveBeenCalledWith(expect.anything(), 'tx-agent-kit-worker', 24, 30)
    expect(ensureRetentionCleanerScheduleMock).toHaveBeenCalledWith(expect.anything(), 'tx-agent-kit-worker', 6, 72)
    expect(ensureReleaseStaleReservationsScheduleMock).toHaveBeenCalledWith(expect.anything(), 'tx-agent-kit-worker', 10, 7200)
    expect(ensureAutoRechargeRetryScheduleMock).toHaveBeenCalledWith(expect.anything(), 'tx-agent-kit-worker', 60)
    expect(ensureStorageReconcileScheduleMock).toHaveBeenCalledWith(expect.anything(), 'tx-agent-kit-worker')
    expect(ensureEmailSendsPruneScheduleMock).toHaveBeenCalledWith(expect.anything(), 'email-campaigns', 24, 30)
    expect(syncCampaignDefinitionsMock).toHaveBeenCalledTimes(1)
    expect(ensureDripSweepScheduleMock).toHaveBeenCalledWith(expect.anything(), 'email-campaigns', 5, 100, 50)
    expect(ensureLifecycleScanScheduleMock).toHaveBeenCalledWith(expect.anything(), 'tx-agent-kit-worker', 24)
    expect(startOutboxDispatcherMock).toHaveBeenCalledWith({
      client: anything(),
      defaultTaskQueue: 'tx-agent-kit-worker',
      emailCampaignsTaskQueue: 'email-campaigns',
      batchSize: 50,
      backstopIntervalSeconds: 10,
      listenerDatabaseUrl: 'postgresql://localhost:5432/test'
    })
    // Campaign definitions converge before the drip sweep schedule is ensured.
    expect(syncCampaignDefinitionsMock.mock.invocationCallOrder[0]).toBeLessThan(
      ensureDripSweepScheduleMock.mock.invocationCallOrder[0] ?? 0
    )

    await sendSigtermOnceStarted()
    await waitForExit(0)
  })

  it('abandons background reconciliation on shutdown and still exits promptly', async () => {
    ensureStuckEventsResetScheduleMock.mockRejectedValue(describeScheduleDeadline())

    try {
      await import('./index.js')
      await vi.waitFor(() => {
        expect(ensureStuckEventsResetScheduleMock.mock.calls.length).toBeGreaterThan(1)
      })

      await sendSigtermOnceStarted()
      await waitForExit(0)

      const callsAtExit = ensureStuckEventsResetScheduleMock.mock.calls.length
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(ensureStuckEventsResetScheduleMock.mock.calls.length).toBe(callsAtExit)
      expect(loggerErrorMock).not.toHaveBeenCalled()
    } finally {
      ensureStuckEventsResetScheduleMock.mockImplementation(() => Promise.resolve(undefined))
    }
  })
})
