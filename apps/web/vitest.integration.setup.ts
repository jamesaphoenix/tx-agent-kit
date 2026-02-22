import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest'
import { resetMockRouter } from './integration/mocks/next-navigation'
import { resolveWebIntegrationPort } from './integration/support/web-integration-harness'
import { resolveVitestWorkerOffset, resolveVitestWorkerSlot } from './integration/support/vitest-worker'
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

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    promise: vi.fn()
  }
}))

const shouldResetBackendStateForCurrentTest = (): boolean => {
  const testState = expect.getState()
  const testPath = testState.testPath ?? ''
  const testName = (testState.currentTestName ?? '').toLowerCase()

  const isRedirectOnlyFlow =
    testName.includes('redirects to sign-in when no auth token is present') ||
    testName.includes('redirects to sign-in and clears session when auth token is invalid')

  if (isRedirectOnlyFlow) {
    return false
  }

  return !(
    testPath.endsWith('apps/web/components/SignOutButton.integration.test.tsx') ||
    testPath.endsWith('apps/web/lib/client-auth.integration.test.ts')
  )
}

beforeAll(async () => {
  await setupWebIntegrationSuite()
})

beforeEach(async () => {
  if (shouldResetBackendStateForCurrentTest()) {
    await resetWebIntegrationCase()
  }
  resetMockRouter()
  vi.clearAllMocks()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

afterAll(async () => {
  await teardownWebIntegrationSuite()
})
