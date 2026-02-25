import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMobileEnv, _resetEnvCacheForTest } from './env'

const defaultApiBaseUrl = 'http://localhost:4000'
const defaultOtelEndpoint = 'http://localhost:4320'
const defaultNodeEnv = 'development'

let mockExtra: Record<string, unknown> | undefined = {
  API_BASE_URL: 'https://test-api.example.com',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'https://test-otel.example.com',
  NODE_ENV: 'staging',
  SENTRY_DSN: 'https://mobile@sentry.example.com/123'
}

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: mockExtra }
    }
  }
}))

describe('getMobileEnv', () => {
  beforeEach(() => {
    mockExtra = {
      API_BASE_URL: 'https://test-api.example.com',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://test-otel.example.com',
      NODE_ENV: 'staging',
      SENTRY_DSN: 'https://mobile@sentry.example.com/123'
    }
    _resetEnvCacheForTest()
  })

  it('reads API_BASE_URL from expo config extra', () => {
    const env = getMobileEnv()
    expect(env.API_BASE_URL).toBe('https://test-api.example.com')
  })

  it('reads OTLP endpoint from expo config extra', () => {
    const env = getMobileEnv()
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://test-otel.example.com')
  })

  it('reads NODE_ENV from expo config extra', () => {
    const env = getMobileEnv()
    expect(env.NODE_ENV).toBe('staging')
  })

  it('reads SENTRY_DSN from expo config extra', () => {
    const env = getMobileEnv()
    expect(env.SENTRY_DSN).toBe('https://mobile@sentry.example.com/123')
  })

  it('returns cached env on subsequent calls', () => {
    const first = getMobileEnv()
    const second = getMobileEnv()
    expect(first).toBe(second)
  })

  it('falls back to default when extra is missing', () => {
    mockExtra = undefined
    const env = getMobileEnv()
    expect(env.API_BASE_URL).toBe(defaultApiBaseUrl)
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(defaultOtelEndpoint)
    expect(env.NODE_ENV).toBe(defaultNodeEnv)
    expect(env.SENTRY_DSN).toBeUndefined()
  })

  it('falls back to default when API_BASE_URL is not a string', () => {
    mockExtra = { API_BASE_URL: 4000 }
    const env = getMobileEnv()
    expect(env.API_BASE_URL).toBe(defaultApiBaseUrl)
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(defaultOtelEndpoint)
    expect(env.NODE_ENV).toBe(defaultNodeEnv)
  })

  it('falls back to default when OTLP endpoint is not a string', () => {
    mockExtra = {
      API_BASE_URL: 'https://test-api.example.com',
      OTEL_EXPORTER_OTLP_ENDPOINT: 4320
    }
    const env = getMobileEnv()
    expect(env.API_BASE_URL).toBe('https://test-api.example.com')
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(defaultOtelEndpoint)
  })

  it('falls back to default when NODE_ENV is not a string', () => {
    mockExtra = {
      API_BASE_URL: 'https://test-api.example.com',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://test-otel.example.com',
      NODE_ENV: 123
    }
    const env = getMobileEnv()
    expect(env.NODE_ENV).toBe(defaultNodeEnv)
    expect(env.SENTRY_DSN).toBeUndefined()
  })

  it('treats empty SENTRY_DSN values as undefined', () => {
    mockExtra = {
      API_BASE_URL: 'https://test-api.example.com',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://test-otel.example.com',
      NODE_ENV: 'staging',
      SENTRY_DSN: '   '
    }

    const env = getMobileEnv()
    expect(env.SENTRY_DSN).toBeUndefined()
  })
})
