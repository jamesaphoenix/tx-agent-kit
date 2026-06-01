import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationFailure } from '@temporalio/common'

const hoisted = vi.hoisted(() => ({
  errorLog: vi.fn(),
  warnLog: vi.fn(),
  captureMock: vi.fn(),
  info: {
    activityId: 'activity-1',
    activityType: 'publishScheduledPost',
    attempt: 1,
    workflowExecution: { workflowId: 'wf-1', runId: 'run-1' }
  }
}))

vi.mock('@tx-agent-kit/logging', () => {
  const logger = {
    error: hoisted.errorLog,
    warn: hoisted.warnLog,
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return { createLogger: () => logger }
})

vi.mock('./observability/sentry.js', () => ({
  captureWorkerActivityError: hoisted.captureMock
}))

vi.mock('@temporalio/activity', () => ({
  Context: { current: () => ({ info: hoisted.info }) }
}))

const { ActivityErrorBoundaryInterceptor } = await import('./activity-error-boundary.js')

type NextFn = (input: unknown) => Promise<unknown>

const execute = (next: NextFn): Promise<unknown> => {
  const interceptor = new ActivityErrorBoundaryInterceptor()
  // The interceptor passes `input` straight through to `next` and ignores it.
  return interceptor.execute({ args: [], headers: {} }, next)
}

afterEach(() => vi.clearAllMocks())

describe('ActivityErrorBoundaryInterceptor', () => {
  it('passes through success without logging or capturing', async () => {
    const result = await execute(() => Promise.resolve('ok'))
    expect(result).toBe('ok')
    expect(hoisted.errorLog).not.toHaveBeenCalled()
    expect(hoisted.warnLog).not.toHaveBeenCalled()
    expect(hoisted.captureMock).not.toHaveBeenCalled()
  })

  it('logs at error + captures to Sentry for a NON-retryable ApplicationFailure, and re-throws', async () => {
    const failure = ApplicationFailure.create({ message: 'permanent', type: 'PermanentPublishError', nonRetryable: true })
    await expect(execute(() => Promise.reject(failure))).rejects.toBe(failure)
    expect(hoisted.errorLog).toHaveBeenCalledTimes(1)
    expect(hoisted.captureMock).toHaveBeenCalledTimes(1)
    expect(hoisted.warnLog).not.toHaveBeenCalled()
  })

  it('logs at warn (no Sentry) for a RETRYABLE ApplicationFailure, and re-throws', async () => {
    const failure = ApplicationFailure.create({ message: 'transient', type: 'TransientPublishError', nonRetryable: false })
    await expect(execute(() => Promise.reject(failure))).rejects.toBe(failure)
    expect(hoisted.warnLog).toHaveBeenCalledTimes(1)
    expect(hoisted.errorLog).not.toHaveBeenCalled()
    expect(hoisted.captureMock).not.toHaveBeenCalled()
  })

  it('treats a plain Error as a reportable fault (error + Sentry)', async () => {
    const boom = new Error('db connection lost')
    await expect(execute(() => Promise.reject(boom))).rejects.toBe(boom)
    expect(hoisted.errorLog).toHaveBeenCalledTimes(1)
    expect(hoisted.captureMock).toHaveBeenCalledTimes(1)
  })

  it('tags logs with the activity/workflow context', async () => {
    await execute(() => Promise.reject(new Error('boom'))).catch(() => undefined)
    const [, context] = hoisted.errorLog.mock.calls[0] as [string, Record<string, unknown>]
    expect(context).toMatchObject({
      workflowId: 'wf-1',
      activityId: 'activity-1',
      activityType: 'publishScheduledPost'
    })
  })
})
