import { describe, expect, it } from 'vitest'
import { firstWorkerToStop, resolveWorkerExitCode, settleWorkerRuns } from './worker-supervisor.js'

const never = () => new Promise<void>(() => undefined)

describe('firstWorkerToStop', () => {
  it('settles as soon as ANY worker fails, even while the other keeps polling', async () => {
    const namespaceError = new Error('Namespace production was not found or otherwise could not be described')
    const outcome = await firstWorkerToStop([
      { taskQueue: 'default', run: never() },
      { taskQueue: 'email-campaigns', run: Promise.reject(namespaceError) }
    ])

    expect(outcome).toEqual({ kind: 'failed', taskQueue: 'email-campaigns', error: namespaceError })
  })

  it('settles as soon as ANY worker stops cleanly, even while the other keeps polling', async () => {
    const outcome = await firstWorkerToStop([
      { taskQueue: 'default', run: Promise.resolve() },
      { taskQueue: 'email-campaigns', run: never() }
    ])

    expect(outcome).toEqual({ kind: 'stopped', taskQueue: 'default' })
  })
})

describe('settleWorkerRuns', () => {
  it('reports every worker outcome without rejecting', async () => {
    const error = new Error('boom')
    await expect(settleWorkerRuns([
      { taskQueue: 'default', run: Promise.resolve() },
      { taskQueue: 'email-campaigns', run: Promise.reject(error) }
    ])).resolves.toEqual([
      { kind: 'stopped', taskQueue: 'default' },
      { kind: 'failed', taskQueue: 'email-campaigns', error }
    ])
  })
})

describe('resolveWorkerExitCode', () => {
  const stopped = (taskQueue: string) => ({ kind: 'stopped' as const, taskQueue })
  const failed = (taskQueue: string) => ({ kind: 'failed' as const, taskQueue, error: new Error('x') })

  it('exits 0 only for a requested shutdown in which every worker stopped cleanly', () => {
    expect(resolveWorkerExitCode([stopped('a'), stopped('b')], true)).toBe(0)
  })

  it('exits 1 when a worker stopped on its own (no shutdown was requested)', () => {
    expect(resolveWorkerExitCode([stopped('a'), stopped('b')], false)).toBe(1)
  })

  it('exits 1 when any worker failed, requested shutdown or not', () => {
    expect(resolveWorkerExitCode([stopped('a'), failed('b')], true)).toBe(1)
    expect(resolveWorkerExitCode([failed('a'), stopped('b')], false)).toBe(1)
  })

  it('exits 1 when there are no outcomes at all', () => {
    expect(resolveWorkerExitCode([], true)).toBe(1)
  })
})
