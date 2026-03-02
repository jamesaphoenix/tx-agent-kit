import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeConnection } from '@temporalio/worker'
import {
  getWorkerEnv,
  resolveWorkerTemporalConnectionOptions
} from './config/env.js'

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/tx_agent_kit')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('worker temporal connectivity integration', () => {
  it(
    'connects to the configured Temporal endpoint and performs a real API call',
    async () => {
      const env = getWorkerEnv()
      const connection = await NativeConnection.connect(
        resolveWorkerTemporalConnectionOptions(env)
      )
      const systemInfo = await connection.workflowService.getSystemInfo({})
      const namespace = await connection.workflowService.describeNamespace({
        namespace: env.TEMPORAL_NAMESPACE
      })
      await connection.close()
      expect(systemInfo).toBeDefined()
      expect(namespace.namespaceInfo?.name).toBe(env.TEMPORAL_NAMESPACE)
    },
    60_000
  )
})
