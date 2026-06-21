import { AutoFixTriggerPort } from '@tx-agent-kit/core'
import type { AutoFixWorkflowPayload } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetApiEnvCache } from '../config/env.js'
import { AutoFixTriggerLive } from './temporal-control.js'

const temporalMocks = vi.hoisted(() => {
  class MockWorkflowExecutionAlreadyStartedError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'WorkflowExecutionAlreadyStartedError'
    }
  }

  const close = vi.fn(() => Promise.resolve(undefined))
  const connection = { close }
  const connect = vi.fn(() => Promise.resolve(connection))
  const start = vi.fn(() => Promise.resolve({ workflowId: 'auto-fix-x' }))
  const Client = vi.fn(function MockTemporalClient() {
    return {
      workflow: { start }
    }
  })

  return {
    Client,
    close,
    connect,
    connection,
    start,
    WorkflowExecutionAlreadyStartedError: MockWorkflowExecutionAlreadyStartedError
  }
})

vi.mock('@temporalio/client', () => ({
  Client: temporalMocks.Client,
  Connection: {
    connect: temporalMocks.connect
  },
  WorkflowExecutionAlreadyStartedError:
    temporalMocks.WorkflowExecutionAlreadyStartedError
}))

const baseEnv = {
  NODE_ENV: 'development',
  API_PORT: '4000',
  API_HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  API_CORS_ORIGIN: 'http://localhost:3000'
} as const

const ENV_KEYS_TO_CLEAR = [
  'NODE_ENV',
  'API_PORT',
  'API_HOST',
  'DATABASE_URL',
  'AUTH_SECRET',
  'API_CORS_ORIGIN',
  'TEMPORAL_RUNTIME_MODE',
  'TEMPORAL_ADDRESS',
  'TEMPORAL_NAMESPACE',
  'TEMPORAL_API_KEY',
  'TEMPORAL_TLS_ENABLED',
  'TEMPORAL_TLS_SERVER_NAME',
  'TEMPORAL_TLS_CA_CERT_PEM',
  'TEMPORAL_TLS_CLIENT_CERT_PEM',
  'TEMPORAL_TLS_CLIENT_KEY_PEM'
] as const

const snapshotEnv = (): Record<string, string | undefined> => {
  const snapshot: Record<string, string | undefined> = {}
  for (const key of ENV_KEYS_TO_CLEAR) {
    snapshot[key] = process.env[key]
  }
  return snapshot
}

const restoreEnv = (snapshot: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

const applyEnv = (overrides: Record<string, string | undefined>): void => {
  for (const key of ENV_KEYS_TO_CLEAR) {
    delete process.env[key]
  }

  for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

const autoFixPayload: AutoFixWorkflowPayload = {
  sentryIssueId: 'test-123',
  environment: 'staging',
  title: 'TypeError: cannot read property of undefined',
  culprit: 'apps/api/src/handlers/foo.ts',
  permalink: 'https://example.test/issues/test-123/',
  fingerprint: 'fp-abc',
  level: 'error',
  occurredAt: '2026-06-06T00:00:00.000Z'
}

const runStartAutoFixWorkflow = (input: AutoFixWorkflowPayload) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const trigger = yield* AutoFixTriggerPort
      return yield* trigger.startAutoFixWorkflow(input)
    }).pipe(Effect.provide(AutoFixTriggerLive))
  )

describe('AutoFixTriggerLive', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = snapshotEnv()
    vi.clearAllMocks()
    temporalMocks.connect.mockResolvedValue(temporalMocks.connection)
    temporalMocks.start.mockResolvedValue({ workflowId: 'auto-fix-test-123' })
    applyEnv({})
    resetApiEnvCache()
  })

  afterEach(() => {
    restoreEnv(originalEnv)
    resetApiEnvCache()
  })

  it('starts the auto-fix workflow on the auto-fix queue with REJECT_DUPLICATE', async () => {
    await expect(runStartAutoFixWorkflow(autoFixPayload)).resolves.toEqual({
      started: true
    })

    expect(temporalMocks.start).toHaveBeenCalledTimes(1)
    expect(temporalMocks.start).toHaveBeenCalledWith('autoFixRequestedWorkflow', {
      taskQueue: 'auto-fix',
      workflowId: 'auto-fix-test-123',
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
      args: [autoFixPayload]
    })
    expect(temporalMocks.close).toHaveBeenCalledTimes(1)
  })

  it('treats an already-started workflow as an idempotent no-op (started: false)', async () => {
    temporalMocks.start.mockRejectedValueOnce(
      new temporalMocks.WorkflowExecutionAlreadyStartedError(
        'Workflow execution already started'
      )
    )

    await expect(runStartAutoFixWorkflow(autoFixPayload)).resolves.toEqual({
      started: false
    })

    expect(temporalMocks.start).toHaveBeenCalledTimes(1)
    expect(temporalMocks.close).toHaveBeenCalledTimes(1)
  })

  it('maps other start failures to a transient trigger error', async () => {
    temporalMocks.start.mockRejectedValueOnce(new Error('connection refused'))

    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.gen(function* () {
          const trigger = yield* AutoFixTriggerPort
          return yield* trigger.startAutoFixWorkflow(autoFixPayload)
        }).pipe(Effect.provide(AutoFixTriggerLive))
      )
    )

    expect(failure).toEqual({
      _tag: 'Transient',
      retryAfterMs: null,
      reason: 'connection refused'
    })
  })
})
