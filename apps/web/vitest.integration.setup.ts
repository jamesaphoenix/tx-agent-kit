import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { resolveWebIntegrationPort } from './integration/support/web-integration-harness'
import { resetIntegrationRouterLocation } from './integration/support/next-router-context'
import {
  releaseVitestWorkerSlot,
  resolveVitestWorkerOffset,
  resolveVitestWorkerSlot
} from './integration/support/vitest-worker'
import {
  resetWebIntegrationCase,
  setupWebIntegrationSuite,
  teardownWebIntegrationSuite
} from './integration/support/web-integration-context'

const workerSlot = resolveVitestWorkerSlot()
const workerOffset = resolveVitestWorkerOffset()
const integrationApiPort = resolveWebIntegrationPort(workerSlot)
const integrationApiBaseUrl = `http://127.0.0.1:${integrationApiPort}`

if (process.env.WEB_INTEGRATION_DEBUG === '1') {
  process.stderr.write(
    [
      '[web-integration]',
      `pid=${process.pid}`,
      `worker_id=${process.env.VITEST_WORKER_ID ?? 'unset'}`,
      `pool_id=${process.env.VITEST_POOL_ID ?? 'unset'}`,
      `slot=${workerSlot}`,
      `offset=${workerOffset}`,
      `api_base=${integrationApiBaseUrl}`
    ].join(' ') + '\n'
  )
}

process.env.NEXT_PUBLIC_API_BASE_URL = integrationApiBaseUrl
process.env.API_BASE_URL = integrationApiBaseUrl

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    }))
  })
}

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    promise: vi.fn()
  }
}))

const shouldResetBackendState = process.env.WEB_INTEGRATION_RESET_EACH_TEST !== '0'

beforeAll(async () => {
  await setupWebIntegrationSuite()
})

beforeEach(async () => {
  if (shouldResetBackendState) {
    await resetWebIntegrationCase()
  }
  resetIntegrationRouterLocation('/')
  vi.clearAllMocks()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

afterAll(async () => {
  try {
    await teardownWebIntegrationSuite()
  } finally {
    releaseVitestWorkerSlot()
  }
})
