import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWorkerEnv } from './env.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getWorkerEnv', () => {
  it('returns default Temporal worker settings', () => {
    vi.stubEnv('TEMPORAL_ADDRESS', undefined)
    vi.stubEnv('TEMPORAL_NAMESPACE', undefined)
    vi.stubEnv('TEMPORAL_TASK_QUEUE', undefined)

    expect(getWorkerEnv()).toEqual({
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'tx-agent-kit'
    })
  })

  it('returns explicit Temporal worker env overrides', () => {
    vi.stubEnv('TEMPORAL_ADDRESS', 'temporal.internal:7233')
    vi.stubEnv('TEMPORAL_NAMESPACE', 'production')
    vi.stubEnv('TEMPORAL_TASK_QUEUE', 'worker-prod')

    expect(getWorkerEnv()).toEqual({
      TEMPORAL_ADDRESS: 'temporal.internal:7233',
      TEMPORAL_NAMESPACE: 'production',
      TEMPORAL_TASK_QUEUE: 'worker-prod'
    })
  })
})
