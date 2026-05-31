import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetWorkerSentryForTest,
  captureWorkerException,
  flushWorkerSentry,
  initializeWorkerSentry
} from './sentry.js'

const defaultSpotlightUrl = 'http://localhost:8969'

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  WORKER_ENABLE_SCHEDULES: false,
  OUTBOX_POLL_BATCH_SIZE: 50,
  OUTBOX_BACKSTOP_INTERVAL_SECONDS: 10,
  OUTBOX_LISTENER_DATABASE_URL: 'postgresql://localhost:5432/test',
  OUTBOX_STUCK_THRESHOLD_MINUTES: 5,
  OUTBOX_PRUNE_RETENTION_DAYS: 30,
  RESERVATION_RECLAIM_MAX_AGE_SECONDS: 7200,
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
  SENTRY_SPOTLIGHT: false,
  RESEND_API_KEY: undefined,
  RESEND_FROM_EMAIL: undefined,
  WEB_BASE_URL: undefined,
  EMAIL_CAMPAIGNS_TASK_QUEUE: 'email-campaigns',
    STRIPE_SECRET_KEY: undefined
}

const probeSpotlight = async (): Promise<boolean> => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(defaultSpotlightUrl, {
      signal: controller.signal
    })
    clearTimeout(timeout)
    return response.ok || response.status < 500
  } catch {
    return false
  }
}

const spotlightReachable = await probeSpotlight()

const startLocalSentrySink = async (): Promise<{
  dsn: string
  close: () => Promise<void>
  getRequestCount: () => number
}> => {
  let requestCount = 0

  const server = createServer((request, response) => {
    requestCount += 1
    request.resume()
    response.statusCode = 200
    response.end('ok')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address !== 'object') {
    throw new Error('Expected local sentry sink to expose a TCP address')
  }

  return {
    dsn: `http://test@127.0.0.1:${address.port}/42`,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
    getRequestCount: () => requestCount
  }
}

describe('worker sentry integration', () => {
  beforeEach(() => {
    _resetWorkerSentryForTest()
  })

  it('is a no-op when WORKER_SENTRY_DSN is not configured and spotlight is off', async () => {
    const initialized = await initializeWorkerSentry(baseEnv)

    captureWorkerException(new Error('no-op'))
    await flushWorkerSentry()

    expect(initialized).toBe(false)
  })

  it('initializes and flushes against a local sink when WORKER_SENTRY_DSN is configured', async () => {
    const sentrySink = await startLocalSentrySink()
    try {
      const initialized = await initializeWorkerSentry({
        ...baseEnv,
        WORKER_SENTRY_DSN: sentrySink.dsn
      })

      captureWorkerException(new Error('integration-capture'))
      await flushWorkerSentry()

      expect(initialized).toBe(true)
      expect(sentrySink.getRequestCount()).toBeGreaterThan(0)
    } finally {
      await sentrySink.close()
    }
  })

  it('initializes with spotlight placeholder DSN when SENTRY_SPOTLIGHT is true and no DSN', async () => {
    const initialized = await initializeWorkerSentry({
      ...baseEnv,
      SENTRY_SPOTLIGHT: true
    })

    expect(initialized).toBe(true)
  })
})

describe('worker sentry spotlight integration', () => {
  beforeEach(() => {
    _resetWorkerSentryForTest()
  })

  it.skipIf(!spotlightReachable)(
    'initializes with spotlight and delivers events to real sidecar',
    async () => {
      const initialized = await initializeWorkerSentry({
        ...baseEnv,
        SENTRY_SPOTLIGHT: true
      })

      expect(initialized).toBe(true)

      const marker = `worker-spotlight-${randomUUID()}`
      captureWorkerException(new Error(marker))
      await flushWorkerSentry()
    }
  )

  it.skipIf(!spotlightReachable)(
    'initializes with spotlight and real DSN against local sink',
    async () => {
      const sentrySink = await startLocalSentrySink()
      try {
        const initialized = await initializeWorkerSentry({
          ...baseEnv,
          WORKER_SENTRY_DSN: sentrySink.dsn,
          SENTRY_SPOTLIGHT: true
        })

        expect(initialized).toBe(true)

        const marker = `worker-spotlight-dsn-${randomUUID()}`
        captureWorkerException(new Error(marker))
        await flushWorkerSentry()

        expect(sentrySink.getRequestCount()).toBeGreaterThan(0)
      } finally {
        await sentrySink.close()
      }
    }
  )
})
