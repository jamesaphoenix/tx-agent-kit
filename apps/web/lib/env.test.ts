import { beforeEach, describe, expect, it, vi } from 'vitest'

const defaultApiBaseUrl = 'http://localhost:4000'
const defaultOtelEndpoint = 'http://localhost:4320'
const defaultNodeEnv = 'development'
const mutableProcessEnv = process.env as Record<string, string | undefined>
const envKeys = [
  'NEXT_PUBLIC_API_BASE_URL',
  'API_BASE_URL',
  'NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'NEXT_PUBLIC_NODE_ENV',
  'NODE_ENV',
  'NEXT_PUBLIC_SENTRY_DSN'
] as const

const clearEnvOverrides = (): void => {
  for (const envKey of envKeys) {
    delete mutableProcessEnv[envKey]
  }
}

describe('getWebEnv', () => {
  beforeEach(() => {
    vi.resetModules()
    clearEnvOverrides()
  })

  it('prefers NEXT_PUBLIC values when set', async () => {
    mutableProcessEnv.NEXT_PUBLIC_API_BASE_URL = 'https://web-api.example.com'
    mutableProcessEnv.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example.com'
    mutableProcessEnv.NEXT_PUBLIC_NODE_ENV = 'staging'
    mutableProcessEnv.NEXT_PUBLIC_SENTRY_DSN =
      'https://public@sentry.example.com/123'

    const { getWebEnv: freshGetWebEnv } = await import('./env')
    const env = freshGetWebEnv()

    expect(env.API_BASE_URL).toBe('https://web-api.example.com')
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://otel.example.com')
    expect(env.NODE_ENV).toBe('staging')
    expect(env.SENTRY_DSN).toBe('https://public@sentry.example.com/123')
  })

  it('falls back to non-public values', async () => {
    mutableProcessEnv.API_BASE_URL = 'https://api.internal.example.com'
    mutableProcessEnv.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.internal.example.com'
    mutableProcessEnv.NODE_ENV = 'test'
    mutableProcessEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://internal@sentry.example.com/456'

    const { getWebEnv: freshGetWebEnv } = await import('./env')
    const env = freshGetWebEnv()

    expect(env.API_BASE_URL).toBe('https://api.internal.example.com')
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://otel.internal.example.com')
    expect(env.NODE_ENV).toBe('test')
    expect(env.SENTRY_DSN).toBe('https://internal@sentry.example.com/456')
  })

  it('falls back to defaults when env vars are missing', async () => {
    const { getWebEnv: freshGetWebEnv } = await import('./env')
    const env = freshGetWebEnv()

    expect(env.API_BASE_URL).toBe(defaultApiBaseUrl)
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(defaultOtelEndpoint)
    expect(env.NODE_ENV).toBe(defaultNodeEnv)
    expect(env.SENTRY_DSN).toBeUndefined()
  })

  it('returns cached object on repeated calls', async () => {
    mutableProcessEnv.NEXT_PUBLIC_API_BASE_URL = 'https://cache-api.example.com'
    mutableProcessEnv.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT = 'https://cache-otel.example.com'
    mutableProcessEnv.NEXT_PUBLIC_NODE_ENV = 'preview'
    mutableProcessEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://cache@sentry.example.com/789'

    const { getWebEnv: freshGetWebEnv } = await import('./env')
    const first = freshGetWebEnv()
    mutableProcessEnv.NEXT_PUBLIC_API_BASE_URL = 'https://changed.example.com'
    mutableProcessEnv.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT =
      'https://changed-otel.example.com'
    mutableProcessEnv.NEXT_PUBLIC_NODE_ENV = 'production'
    mutableProcessEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://changed@sentry.example.com/999'
    const second = freshGetWebEnv()

    expect(first).toBe(second)
    expect(second.API_BASE_URL).toBe('https://cache-api.example.com')
    expect(second.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://cache-otel.example.com')
    expect(second.NODE_ENV).toBe('preview')
    expect(second.SENTRY_DSN).toBe('https://cache@sentry.example.com/789')
  })
})
