import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMobileEnv, _resetEnvCacheForTest } from './env'

const defaultApiBaseUrl = 'http://localhost:4000'

let mockExtra: Record<string, unknown> | undefined = {
  API_BASE_URL: 'https://test-api.example.com'
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
    mockExtra = { API_BASE_URL: 'https://test-api.example.com' }
    _resetEnvCacheForTest()
  })

  it('reads API_BASE_URL from expo config extra', () => {
    const env = getMobileEnv()
    expect(env.API_BASE_URL).toBe('https://test-api.example.com')
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
  })

  it('falls back to default when API_BASE_URL is not a string', () => {
    mockExtra = { API_BASE_URL: 4000 }
    const env = getMobileEnv()
    expect(env.API_BASE_URL).toBe(defaultApiBaseUrl)
  })
})
