import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetWebEnvCache } from './env'

const resourceHintMocks = vi.hoisted(() => ({
  preconnect: vi.fn(),
  prefetchDNS: vi.fn()
}))

vi.mock('react-dom', () => ({
  preconnect: resourceHintMocks.preconnect,
  prefetchDNS: resourceHintMocks.prefetchDNS
}))

const mutableProcessEnv = process.env as Record<string, string | undefined>
const envKeys = [
  'NEXT_PUBLIC_API_BASE_URL',
  'API_BASE_URL',
  'NEXT_PUBLIC_SITE_URL'
] as const

const clearEnvOverrides = (): void => {
  for (const envKey of envKeys) {
    Reflect.deleteProperty(mutableProcessEnv, envKey)
  }
}

describe('resolveApiResourceHintOrigin', () => {
  beforeEach(() => {
    clearEnvOverrides()
    resetWebEnvCache()
    resourceHintMocks.preconnect.mockClear()
    resourceHintMocks.prefetchDNS.mockClear()
  })

  it('returns the origin for a distinct absolute API base URL', async () => {
    const { resolveApiResourceHintOrigin } = await import('./api-resource-hints')

    expect(
      resolveApiResourceHintOrigin(
        'https://api.example.test/v1',
        'https://app.example.test'
      )
    ).toBe('https://api.example.test')
  })

  it('skips empty, relative, and same-origin API base URLs', async () => {
    const { resolveApiResourceHintOrigin } = await import('./api-resource-hints')

    expect(resolveApiResourceHintOrigin('', 'https://app.example.test')).toBeNull()
    expect(
      resolveApiResourceHintOrigin(
        'https://app.example.test/api',
        'https://app.example.test'
      )
    ).toBeNull()
    expect(resolveApiResourceHintOrigin('/api', 'https://app.example.test')).toBeNull()
  })

  it('skips invalid or non-http API base URLs', async () => {
    const { resolveApiResourceHintOrigin } = await import('./api-resource-hints')

    expect(resolveApiResourceHintOrigin('http://', 'https://app.example.test')).toBeNull()
    expect(
      resolveApiResourceHintOrigin(
        'mailto:support@example.com',
        'https://app.example.test'
      )
    ).toBeNull()
  })
})

describe('ApiResourceHints', () => {
  beforeEach(() => {
    clearEnvOverrides()
    resetWebEnvCache()
    resourceHintMocks.preconnect.mockClear()
    resourceHintMocks.prefetchDNS.mockClear()
  })

  it('warms DNS and a credentialed API connection for a distinct API origin', async () => {
    mutableProcessEnv.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.test/v1'
    mutableProcessEnv.NEXT_PUBLIC_SITE_URL = 'https://app.example.test'
    const { ApiResourceHints } = await import('./api-resource-hints')

    expect(ApiResourceHints()).toBeNull()

    expect(resourceHintMocks.prefetchDNS).toHaveBeenCalledWith('https://api.example.test')
    expect(resourceHintMocks.preconnect).toHaveBeenCalledWith(
      'https://api.example.test',
      { crossOrigin: 'use-credentials' }
    )
  })

  it('does not emit hints when the API is same-origin', async () => {
    mutableProcessEnv.NEXT_PUBLIC_API_BASE_URL = 'https://app.example.test/api'
    mutableProcessEnv.NEXT_PUBLIC_SITE_URL = 'https://app.example.test'
    const { ApiResourceHints } = await import('./api-resource-hints')

    expect(ApiResourceHints()).toBeNull()

    expect(resourceHintMocks.prefetchDNS).not.toHaveBeenCalled()
    expect(resourceHintMocks.preconnect).not.toHaveBeenCalled()
  })
})
