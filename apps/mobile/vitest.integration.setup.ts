import { clearAuthToken } from './lib/auth-token'
import { sessionStoreActions } from './stores/session-store'
import {
  mobileIntegrationBaseUrl,
  resetMobileIntegrationCase,
  setupMobileIntegrationSuite,
  teardownMobileIntegrationSuite
} from './integration/support/mobile-integration-context'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'

process.env.MOBILE_INTEGRATION_API_BASE_URL = mobileIntegrationBaseUrl
process.env.EXPO_PUBLIC_API_BASE_URL = mobileIntegrationBaseUrl

beforeAll(async () => {
  process.env.MOBILE_INTEGRATION_API_BASE_URL = mobileIntegrationBaseUrl
  process.env.EXPO_PUBLIC_API_BASE_URL = mobileIntegrationBaseUrl
  await setupMobileIntegrationSuite()
})

beforeEach(async () => {
  process.env.MOBILE_INTEGRATION_API_BASE_URL = mobileIntegrationBaseUrl
  process.env.EXPO_PUBLIC_API_BASE_URL = mobileIntegrationBaseUrl
  await resetMobileIntegrationCase()
  await clearAuthToken()
  sessionStoreActions.clear()
  vi.clearAllMocks()
})

afterAll(async () => {
  await teardownMobileIntegrationSuite()
})
