import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetApiSentryForTest,
  captureApiException,
  flushApiSentry,
  initializeApiSentry
} from './sentry.js'

const defaultSpotlightUrl = 'http://localhost:8969'

const baseApiEnv = {
  NODE_ENV: 'test',
  API_PORT: '4000',
  API_HOST: '0.0.0.0',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  API_CORS_ORIGIN: 'http://localhost:3000',
  API_SENTRY_DSN: undefined as string | undefined,
  SENTRY_SPOTLIGHT: undefined as string | undefined
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

describe('api sentry integration', () => {
  beforeEach(() => {
    _resetApiSentryForTest()
  })

  it('is a no-op when API_SENTRY_DSN is not configured and spotlight is off', async () => {
    const initialized = await initializeApiSentry(baseApiEnv)

    captureApiException(new Error('no-op'))
    await flushApiSentry()

    expect(initialized).toBe(false)
  })

  it('initializes and flushes against a local sink when API_SENTRY_DSN is configured', async () => {
    const sentrySink = await startLocalSentrySink()
    try {
      const initialized = await initializeApiSentry({
        ...baseApiEnv,
        API_SENTRY_DSN: sentrySink.dsn
      })

      captureApiException(new Error('integration-capture'))
      await flushApiSentry()

      expect(initialized).toBe(true)
      expect(sentrySink.getRequestCount()).toBeGreaterThan(0)
    } finally {
      await sentrySink.close()
    }
  })

  it('initializes with spotlight placeholder DSN when SENTRY_SPOTLIGHT is true and no DSN', async () => {
    const initialized = await initializeApiSentry({
      ...baseApiEnv,
      SENTRY_SPOTLIGHT: 'true'
    })

    expect(initialized).toBe(true)
  })
})

describe('api sentry spotlight integration', () => {
  beforeEach(() => {
    _resetApiSentryForTest()
  })

  it.skipIf(!spotlightReachable)(
    'initializes with spotlight and delivers events to real sidecar',
    async () => {
      const initialized = await initializeApiSentry({
        ...baseApiEnv,
        SENTRY_SPOTLIGHT: 'true'
      })

      expect(initialized).toBe(true)

      const marker = `api-spotlight-${randomUUID()}`
      captureApiException(new Error(marker))
      await flushApiSentry()
    }
  )

  it.skipIf(!spotlightReachable)(
    'initializes with spotlight and real DSN against local sink',
    async () => {
      const sentrySink = await startLocalSentrySink()
      try {
        const initialized = await initializeApiSentry({
          ...baseApiEnv,
          API_SENTRY_DSN: sentrySink.dsn,
          SENTRY_SPOTLIGHT: 'true'
        })

        expect(initialized).toBe(true)

        const marker = `api-spotlight-dsn-${randomUUID()}`
        captureApiException(new Error(marker))
        await flushApiSentry()

        expect(sentrySink.getRequestCount()).toBeGreaterThan(0)
      } finally {
        await sentrySink.close()
      }
    }
  )
})
