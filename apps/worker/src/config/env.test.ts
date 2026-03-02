import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEnv } from './env.js'
import { getWorkerEnv, resetWorkerEnvCache, resolveWorkerTemporalConnectionOptions } from './env.js'

afterEach(() => {
  vi.unstubAllEnvs()
  resetWorkerEnvCache()
})

describe('getWorkerEnv', () => {
  it('returns default Temporal worker settings', () => {
    vi.stubEnv('NODE_ENV', undefined)
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
    vi.stubEnv('OUTBOX_POLL_BATCH_SIZE', undefined)
    vi.stubEnv('OUTBOX_STUCK_THRESHOLD_MINUTES', undefined)
    vi.stubEnv('OUTBOX_PRUNE_RETENTION_DAYS', undefined)
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', undefined)
    vi.stubEnv('TEMPORAL_ADDRESS', undefined)
    vi.stubEnv('TEMPORAL_NAMESPACE', undefined)
    vi.stubEnv('TEMPORAL_TASK_QUEUE', undefined)
    vi.stubEnv('TEMPORAL_API_KEY', undefined)
    vi.stubEnv('TEMPORAL_TLS_ENABLED', undefined)
    vi.stubEnv('TEMPORAL_TLS_SERVER_NAME', undefined)
    vi.stubEnv('TEMPORAL_TLS_CA_CERT_PEM', undefined)
    vi.stubEnv('TEMPORAL_TLS_CLIENT_CERT_PEM', undefined)
    vi.stubEnv('TEMPORAL_TLS_CLIENT_KEY_PEM', undefined)
    vi.stubEnv('WORKER_SENTRY_DSN', undefined)
    vi.stubEnv('RESEND_API_KEY', undefined)
    vi.stubEnv('RESEND_FROM_EMAIL', undefined)
    vi.stubEnv('WEB_BASE_URL', undefined)

    expect(getWorkerEnv()).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/test',
      OUTBOX_POLL_BATCH_SIZE: 50,
      OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
      OUTBOX_PRUNE_RETENTION_DAYS: 30,
      TEMPORAL_RUNTIME_MODE: 'cli',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'tx-agent-kit',
      TEMPORAL_API_KEY: undefined,
      TEMPORAL_TLS_ENABLED: false,
      TEMPORAL_TLS_SERVER_NAME: undefined,
      TEMPORAL_TLS_CA_CERT_PEM: undefined,
      TEMPORAL_TLS_CLIENT_CERT_PEM: undefined,
      TEMPORAL_TLS_CLIENT_KEY_PEM: undefined,
      WORKER_SENTRY_DSN: undefined,
      RESEND_API_KEY: undefined,
      RESEND_FROM_EMAIL: undefined,
      WEB_BASE_URL: undefined
    })
  })

  it('returns explicit Temporal worker env overrides for cloud mode', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/prod')
    vi.stubEnv('OUTBOX_POLL_BATCH_SIZE', '100')
    vi.stubEnv('OUTBOX_STUCK_THRESHOLD_MINUTES', undefined)
    vi.stubEnv('OUTBOX_PRUNE_RETENTION_DAYS', undefined)
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'cloud')
    vi.stubEnv('TEMPORAL_ADDRESS', 'temporal.internal:7233')
    vi.stubEnv('TEMPORAL_NAMESPACE', 'production')
    vi.stubEnv('TEMPORAL_TASK_QUEUE', 'worker-prod')
    vi.stubEnv('TEMPORAL_API_KEY', 'cloud-api-key')
    vi.stubEnv('TEMPORAL_TLS_ENABLED', 'true')
    vi.stubEnv('TEMPORAL_TLS_SERVER_NAME', 'temporal.example.com')
    vi.stubEnv('TEMPORAL_TLS_CA_CERT_PEM', 'ca-cert')
    vi.stubEnv('TEMPORAL_TLS_CLIENT_CERT_PEM', 'client-cert')
    vi.stubEnv('TEMPORAL_TLS_CLIENT_KEY_PEM', 'client-key')
    vi.stubEnv('WORKER_SENTRY_DSN', 'https://worker@sentry.example.com/123')
    vi.stubEnv('RESEND_API_KEY', undefined)
    vi.stubEnv('RESEND_FROM_EMAIL', undefined)
    vi.stubEnv('WEB_BASE_URL', undefined)

    expect(getWorkerEnv()).toEqual({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      OUTBOX_POLL_BATCH_SIZE: 100,
      OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
      OUTBOX_PRUNE_RETENTION_DAYS: 30,
      TEMPORAL_RUNTIME_MODE: 'cloud',
      TEMPORAL_ADDRESS: 'temporal.internal:7233',
      TEMPORAL_NAMESPACE: 'production',
      TEMPORAL_TASK_QUEUE: 'worker-prod',
      TEMPORAL_API_KEY: 'cloud-api-key',
      TEMPORAL_TLS_ENABLED: true,
      TEMPORAL_TLS_SERVER_NAME: 'temporal.example.com',
      TEMPORAL_TLS_CA_CERT_PEM: 'ca-cert',
      TEMPORAL_TLS_CLIENT_CERT_PEM: 'client-cert',
      TEMPORAL_TLS_CLIENT_KEY_PEM: 'client-key',
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/123',
      RESEND_API_KEY: undefined,
      RESEND_FROM_EMAIL: undefined,
      WEB_BASE_URL: undefined
    })
  })

  it('throws for invalid runtime mode', () => {
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'invalid-mode')

    expect(() => getWorkerEnv()).toThrow(
      "Invalid TEMPORAL_RUNTIME_MODE 'invalid-mode'"
    )
  })

  it('throws when cloud mode is missing API key', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'cloud')
    vi.stubEnv('TEMPORAL_API_KEY', undefined)

    expect(() => getWorkerEnv()).toThrow(
      'TEMPORAL_API_KEY is required when TEMPORAL_RUNTIME_MODE=cloud'
    )
  })

  it('throws when cloud mode disables TLS', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'cloud')
    vi.stubEnv('TEMPORAL_API_KEY', 'cloud-api-key')
    vi.stubEnv('TEMPORAL_TLS_ENABLED', 'false')

    expect(() => getWorkerEnv()).toThrow(
      'TEMPORAL_TLS_ENABLED must be true when TEMPORAL_RUNTIME_MODE=cloud'
    )
  })

  it('throws when only one client cert field is provided', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
    vi.stubEnv('TEMPORAL_TLS_ENABLED', 'true')
    vi.stubEnv('TEMPORAL_TLS_CLIENT_CERT_PEM', 'client-cert')
    vi.stubEnv('TEMPORAL_TLS_CLIENT_KEY_PEM', undefined)

    expect(() => getWorkerEnv()).toThrow(
      'TEMPORAL_TLS_CLIENT_CERT_PEM and TEMPORAL_TLS_CLIENT_KEY_PEM must both be provided when either is set'
    )
  })

  it('throws when TLS material is configured but TLS is disabled', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
    vi.stubEnv('TEMPORAL_TLS_ENABLED', 'false')
    vi.stubEnv('TEMPORAL_TLS_CA_CERT_PEM', 'ca-cert')

    expect(() => getWorkerEnv()).toThrow(
      'TEMPORAL_TLS_ENABLED must be true when TLS server name or TLS certificate material is configured'
    )
  })

  it('normalizes blank optional string values to undefined', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'cli')
    vi.stubEnv('TEMPORAL_API_KEY', '   ')
    vi.stubEnv('TEMPORAL_TLS_SERVER_NAME', '   ')
    vi.stubEnv('TEMPORAL_TLS_CA_CERT_PEM', '   ')
    vi.stubEnv('TEMPORAL_TLS_CLIENT_CERT_PEM', '   ')
    vi.stubEnv('TEMPORAL_TLS_CLIENT_KEY_PEM', '   ')
    vi.stubEnv('WORKER_SENTRY_DSN', '   ')

    expect(getWorkerEnv()).toEqual(
      expect.objectContaining({
        TEMPORAL_API_KEY: undefined,
        TEMPORAL_TLS_SERVER_NAME: undefined,
        TEMPORAL_TLS_CA_CERT_PEM: undefined,
        TEMPORAL_TLS_CLIENT_CERT_PEM: undefined,
        TEMPORAL_TLS_CLIENT_KEY_PEM: undefined,
        WORKER_SENTRY_DSN: undefined
      })
    )
  })

  it('normalizes escaped newlines in TLS PEM values', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/test')
    vi.stubEnv('TEMPORAL_RUNTIME_MODE', 'cloud')
    vi.stubEnv('TEMPORAL_API_KEY', 'cloud-api-key')
    vi.stubEnv('TEMPORAL_TLS_ENABLED', 'true')
    vi.stubEnv('TEMPORAL_TLS_CA_CERT_PEM', 'line-1\\nline-2')
    vi.stubEnv('TEMPORAL_TLS_CLIENT_CERT_PEM', 'cert-1\\ncert-2')
    vi.stubEnv('TEMPORAL_TLS_CLIENT_KEY_PEM', 'key-1\\nkey-2')

    expect(getWorkerEnv()).toEqual(
      expect.objectContaining({
        TEMPORAL_TLS_CA_CERT_PEM: 'line-1\nline-2',
        TEMPORAL_TLS_CLIENT_CERT_PEM: 'cert-1\ncert-2',
        TEMPORAL_TLS_CLIENT_KEY_PEM: 'key-1\nkey-2'
      })
    )
  })
})

describe('resolveWorkerTemporalConnectionOptions', () => {
  it('returns plain address for local CLI mode', () => {
    const env: WorkerEnv = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/test',
      OUTBOX_POLL_BATCH_SIZE: 50,
      OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
      OUTBOX_PRUNE_RETENTION_DAYS: 30,
      TEMPORAL_RUNTIME_MODE: 'cli' as const,
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'tx-agent-kit',
      TEMPORAL_API_KEY: undefined,
      TEMPORAL_TLS_ENABLED: false,
      TEMPORAL_TLS_SERVER_NAME: undefined,
      TEMPORAL_TLS_CA_CERT_PEM: undefined,
      TEMPORAL_TLS_CLIENT_CERT_PEM: undefined,
      TEMPORAL_TLS_CLIENT_KEY_PEM: undefined,
      WORKER_SENTRY_DSN: undefined,
      RESEND_API_KEY: undefined,
      RESEND_FROM_EMAIL: undefined,
      WEB_BASE_URL: undefined
    }

    expect(resolveWorkerTemporalConnectionOptions(env)).toEqual({
      address: 'localhost:7233'
    })
  })

  it('returns API key and TLS config for cloud mode', () => {
    const env: WorkerEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      OUTBOX_POLL_BATCH_SIZE: 50,
      OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
      OUTBOX_PRUNE_RETENTION_DAYS: 30,
      TEMPORAL_RUNTIME_MODE: 'cloud' as const,
      TEMPORAL_ADDRESS: 'cloud.temporal.io:7233',
      TEMPORAL_NAMESPACE: 'cloud.ns',
      TEMPORAL_TASK_QUEUE: 'queue',
      TEMPORAL_API_KEY: 'cloud-api-key',
      TEMPORAL_TLS_ENABLED: true,
      TEMPORAL_TLS_SERVER_NAME: 'cloud.temporal.io',
      TEMPORAL_TLS_CA_CERT_PEM: undefined,
      TEMPORAL_TLS_CLIENT_CERT_PEM: undefined,
      TEMPORAL_TLS_CLIENT_KEY_PEM: undefined,
      WORKER_SENTRY_DSN: 'https://worker@sentry.example.com/456',
      RESEND_API_KEY: undefined,
      RESEND_FROM_EMAIL: undefined,
      WEB_BASE_URL: undefined
    }

    expect(resolveWorkerTemporalConnectionOptions(env)).toEqual({
      address: 'cloud.temporal.io:7233',
      apiKey: 'cloud-api-key',
      tls: {
        serverNameOverride: 'cloud.temporal.io'
      }
    })
  })

  it('returns cert-backed TLS config when optional PEM values are provided', () => {
    const env: WorkerEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/prod',
      OUTBOX_POLL_BATCH_SIZE: 50,
      OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
      OUTBOX_PRUNE_RETENTION_DAYS: 30,
      TEMPORAL_RUNTIME_MODE: 'cloud' as const,
      TEMPORAL_ADDRESS: 'cloud.temporal.io:7233',
      TEMPORAL_NAMESPACE: 'cloud.ns',
      TEMPORAL_TASK_QUEUE: 'queue',
      TEMPORAL_API_KEY: 'cloud-api-key',
      TEMPORAL_TLS_ENABLED: true,
      TEMPORAL_TLS_SERVER_NAME: undefined,
      TEMPORAL_TLS_CA_CERT_PEM: 'ca-cert',
      TEMPORAL_TLS_CLIENT_CERT_PEM: 'client-cert',
      TEMPORAL_TLS_CLIENT_KEY_PEM: 'client-key',
      WORKER_SENTRY_DSN: undefined,
      RESEND_API_KEY: undefined,
      RESEND_FROM_EMAIL: undefined,
      WEB_BASE_URL: undefined
    }

    expect(resolveWorkerTemporalConnectionOptions(env)).toEqual({
      address: 'cloud.temporal.io:7233',
      apiKey: 'cloud-api-key',
      tls: {
        serverRootCACertificate: Buffer.from('ca-cert'),
        clientCertPair: {
          crt: Buffer.from('client-cert'),
          key: Buffer.from('client-key')
        }
      }
    })
  })
})
