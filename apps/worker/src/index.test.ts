import { beforeEach, describe, expect, it, vi } from 'vitest'

const startTelemetryMock = vi.fn(() => Promise.resolve(undefined))
const stopTelemetryMock = vi.fn(() => Promise.resolve(undefined))
const loggerInfoMock = vi.fn()
const closeConnectionMock = vi.fn(() => Promise.resolve(undefined))
const workerShutdownMock = vi.fn()
const workerRunMock = vi.fn(() => Promise.resolve(undefined))
const nativeConnectionConnectMock = vi.fn(() => Promise.resolve({
  close: closeConnectionMock
}))
const workerCreateMock = vi.fn(() => Promise.resolve({
  run: workerRunMock,
  shutdown: workerShutdownMock
}))

vi.mock('@tx-agent-kit/observability', () => ({
  startTelemetry: startTelemetryMock,
  stopTelemetry: stopTelemetryMock
}))

vi.mock('@tx-agent-kit/logging', () => ({
  createLogger: () => ({
    info: loggerInfoMock
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

vi.mock('./activities.js', () => ({
  activities: {}
}))

vi.mock('./config/env.js', () => ({
  getWorkerEnv: () => ({
    TEMPORAL_ADDRESS: 'temporal.internal:7233',
    TEMPORAL_NAMESPACE: 'staging',
    TEMPORAL_TASK_QUEUE: 'tx-agent-kit-worker'
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
      expect(workerRunMock).toHaveBeenCalledTimes(1)
      expect(closeConnectionMock).toHaveBeenCalledTimes(1)
      expect(stopTelemetryMock).toHaveBeenCalledTimes(1)
    })
  })
})
