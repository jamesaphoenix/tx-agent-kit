import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWorkerEnv, resolveWorkerTemporalConnectionOptions } from './env.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getWorkerEnv', () => {
  it('returns default Temporal worker settings', () => {
    vi.stubEnv('NODE_ENV', undefined)
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', undefined)
    vi.stubEnv('TEMPORAL_ADDRESS', undefined)
    vi.stubEnv('TEMPORAL_NAMESPACE', undefined)
    vi.stubEnv('TEMPORAL_TASK_QUEUE', undefined)
    vi.stubEnv('TEMPORAL_API_KEY', undefined)
    vi.stubEnv('TEMPORAL_TLS_ENABLED', undefined)
    vi.stubEnv('TEMPORAL_TLS_SERVER_NAME', undefined)
    vi.stubEnv('WORKER_SENTRY_DSN', undefined)

    expect(getWorkerEnv()).toEqual({
      NODE_ENV: 'development',
      TEMPORAL_RUNTIME_MODE: 'cli',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'tx-agent-kit',
      TEMPORAL_API_KEY: undefined,
      TEMPORAL_TLS_ENABLED: false,
      TEMPORAL_TLS_SERVER_NAME: undefined,
      WORKER_SENTRY_DSN: undefined
    })
  })

  it('returns explicit Temporal worker env overrides for cloud mode', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'cloud')
    vi.stubEnv('TEMPORAL_ADDRESS', 'temporal.internal:7233')
    vi.stubEnv('TEMPORAL_NAMESPACE', 'production')
    vi.stubEnv('TEMPORAL_TASK_QUEUE', 'worker-prod')
    vi.stubEnv('TEMPORAL_API_KEY', 'cloud-api-key')
    vi.stubEnv('TEMPORAL_TLS_ENABLED', 'true')
    vi.stubEnv('TEMPORAL_TLS_SERVER_NAME', 'temporal.example.com')
    vi.stubEnv('WORKER_SENTRY_DSN', 'https://worker@sentry.example.com/123')

    expect(getWorkerEnv()).toEqual({
      NODE_ENV: 'production',
      TEMPORAL_RUNTIME_MODE: 'cloud',
      TEMPORAL_ADDRESS: 'temporal.internal:7233',
      TEMPORAL_NAMESPACE: 'production',
      TEMPORAL_TASK_QUEUE: 'worker-prod',
      TEMPORAL_API_KEY: 'cloud-api-key',
      TEMPORAL_TLS_ENABLED: true,
      TEMPORAL_TLS_SERVER_NAME: 'temporal.example.com',
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/123'
    })
  })

  it('throws for invalid runtime mode', () => {
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'invalid-mode')

    expect(() => getWorkerEnv()).toThrow(
      "Invalid TEMPORAL_RUNTIME_MODE 'invalid-mode'"
    )
  })

  it('throws when cloud mode is missing API key', () => {
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'cloud')
    vi.stubEnv('TEMPORAL_API_KEY', undefined)

    expect(() => getWorkerEnv()).toThrow(
      'TEMPORAL_API_KEY is required when TEMPORAL_RUNTIME_MODE=cloud'
    )
  })

  it('throws when cloud mode disables TLS', () => {
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'cloud')
    vi.stubEnv('TEMPORAL_API_KEY', 'cloud-api-key')
    vi.stubEnv('TEMPORAL_TLS_ENABLED', 'false')

    expect(() => getWorkerEnv()).toThrow(
      'TEMPORAL_TLS_ENABLED must be true when TEMPORAL_RUNTIME_MODE=cloud'
    )
  })

  it('normalizes blank optional string values to undefined', () => {
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'cli')
    vi.stubEnv('TEMPORAL_API_KEY', '   ')
    vi.stubEnv('TEMPORAL_TLS_SERVER_NAME', '   ')
    vi.stubEnv('WORKER_SENTRY_DSN', '   ')

    expect(getWorkerEnv()).toEqual(
      expect.objectContaining({
        TEMPORAL_API_KEY: undefined,
        TEMPORAL_TLS_SERVER_NAME: undefined,
        WORKER_SENTRY_DSN: undefined
      })
    )
  })
})

describe('resolveWorkerTemporalConnectionOptions', () => {
  it('returns plain address for local CLI mode', () => {
    const env = {
      NODE_ENV: 'development',
      TEMPORAL_RUNTIME_MODE: 'cli' as const,
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'tx-agent-kit',
      TEMPORAL_API_KEY: undefined,
      TEMPORAL_TLS_ENABLED: false,
      TEMPORAL_TLS_SERVER_NAME: undefined,
      WORKER_SENTRY_DSN: undefined
    }

    expect(resolveWorkerTemporalConnectionOptions(env)).toEqual({
      address: 'localhost:7233'
    })
  })

  it('returns API key and TLS config for cloud mode', () => {
    const env = {
      NODE_ENV: 'production',
      TEMPORAL_RUNTIME_MODE: 'cloud' as const,
      TEMPORAL_ADDRESS: 'cloud.temporal.io:7233',
      TEMPORAL_NAMESPACE: 'cloud.ns',
      TEMPORAL_TASK_QUEUE: 'queue',
      TEMPORAL_API_KEY: 'cloud-api-key',
      TEMPORAL_TLS_ENABLED: true,
      TEMPORAL_TLS_SERVER_NAME: 'cloud.temporal.io',
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/456'
    }

    expect(resolveWorkerTemporalConnectionOptions(env)).toEqual({
      address: 'cloud.temporal.io:7233',
      apiKey: 'cloud-api-key',
      tls: {
        serverNameOverride: 'cloud.temporal.io'
      }
    })
  })
})
