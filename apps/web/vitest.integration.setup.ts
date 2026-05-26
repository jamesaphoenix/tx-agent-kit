import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'

configure({ asyncUtilTimeout: 5000 })
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { clearAuthToken } from './lib/auth-token'
import { resetIntegrationRouterLocation } from './integration/support/next-router-context'
import {
  resetWebIntegrationCase,
  setupWebIntegrationSuite,
  teardownWebIntegrationSuite,
  integrationBaseUrl
} from './integration/support/web-integration-context'
import { sessionStore, sessionStoreInitialState } from './stores/session-store'

if (process.env.WEB_INTEGRATION_DEBUG === '1') {
  process.stderr.write(
    [
      '[web-integration]',
      `pid=${process.pid}`,
      `worker_id=${process.env.VITEST_WORKER_ID ?? 'unset'}`,
      `pool_id=${process.env.VITEST_POOL_ID ?? 'unset'}`,
      `api_base=${integrationBaseUrl}`
    ].join(' ') + '\n'
  )
}

import { resetWebEnvCache } from './lib/env'
import { api } from './lib/axios'
import { configureExternalNavigationHandler } from './lib/url-state'

process.env.NEXT_PUBLIC_API_BASE_URL = integrationBaseUrl
process.env.API_BASE_URL = integrationBaseUrl
// Reset cached env and update the axios instance to use the test server URL
resetWebEnvCache()
api.defaults.baseURL = integrationBaseUrl

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

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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
  configureExternalNavigationHandler(() => undefined)
  await setupWebIntegrationSuite()
})

beforeEach(async () => {
  if (shouldResetBackendState) {
    await resetWebIntegrationCase()
  }
  resetIntegrationRouterLocation('/')
  vi.clearAllMocks()
  clearAuthToken()
  sessionStore.setState(() => sessionStoreInitialState)
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  clearAuthToken()
  sessionStore.setState(() => sessionStoreInitialState)
  window.localStorage.clear()
})

afterAll(async () => {
  configureExternalNavigationHandler(null)
  await teardownWebIntegrationSuite()
})
