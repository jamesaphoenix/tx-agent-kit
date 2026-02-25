import { clearAuthToken } from './lib/auth-token'
import { sessionStoreActions } from './stores/session-store'
import {
  mobileIntegrationBaseUrl,
  resetMobileIntegrationCase,
  setupMobileIntegrationSuite,
  teardownMobileIntegrationSuite
} from './integration/support/mobile-integration-context'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'

const integrationRuntime = globalThis as Record<string, unknown>
integrationRuntime.__MOBILE_INTEGRATION_API_BASE_URL = mobileIntegrationBaseUrl

beforeAll(async () => {
  integrationRuntime.__MOBILE_INTEGRATION_API_BASE_URL = mobileIntegrationBaseUrl
  await setupMobileIntegrationSuite()
})

beforeEach(async () => {
  integrationRuntime.__MOBILE_INTEGRATION_API_BASE_URL = mobileIntegrationBaseUrl
  await resetMobileIntegrationCase()
  await clearAuthToken()
  sessionStoreActions.clear()
  vi.clearAllMocks()
})

afterAll(async () => {
  await teardownMobileIntegrationSuite()
})
