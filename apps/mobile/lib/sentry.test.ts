import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetEnvCacheForTest } from './env'
import { _resetMobileSentryForTest, initializeMobileSentry } from './sentry'

const hoistedState = vi.hoisted(() => ({
  sentryInitMock: vi.fn(),
  mockExtra: undefined as Record<string, unknown> | undefined
}))

vi.mock('@sentry/react-native', () => ({
  init: hoistedState.sentryInitMock
}))

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: hoistedState.mockExtra }
    }
  }
}))

describe('initializeMobileSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetEnvCacheForTest()
    _resetMobileSentryForTest()
    hoistedState.mockExtra = {
      API_BASE_URL: 'https://test-api.example.com',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://test-otel.example.com',
      NODE_ENV: 'staging'
    }
  })

  it('skips initialization when SENTRY_DSN is not configured', async () => {
    await expect(initializeMobileSentry()).resolves.toBe(false)
    expect(hoistedState.sentryInitMock).not.toHaveBeenCalled()
  })

  it('initializes once when SENTRY_DSN is configured', async () => {
    hoistedState.mockExtra = {
      API_BASE_URL: 'https://test-api.example.com',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://test-otel.example.com',
      NODE_ENV: 'production',
      SENTRY_DSN: 'https://mobile@sentry.example.com/456'
    }
    _resetEnvCacheForTest()

    await expect(initializeMobileSentry()).resolves.toBe(true)
    await expect(initializeMobileSentry()).resolves.toBe(false)
    expect(hoistedState.sentryInitMock).toHaveBeenCalledTimes(1)
    expect(hoistedState.sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://mobile@sentry.example.com/456',
        environment: 'production',
        tracesSampleRate: 0
      })
    )
  })
})
