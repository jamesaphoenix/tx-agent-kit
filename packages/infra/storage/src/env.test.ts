import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('getStorageEnv', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    // Clear cached module
    delete process.env.R2_ACCOUNT_ID
    delete process.env.R2_ACCESS_KEY_ID
    delete process.env.R2_SECRET_ACCESS_KEY
    delete process.env.R2_BUCKET_NAME
    delete process.env.R2_ENDPOINT
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    process.env = originalEnv
  })

  const loadGetStorageEnv = async () => {
    const mod = await import('./env.js')
    return mod.getStorageEnv
  }

  it('returns env values when all R2 credentials are set', async () => {
    process.env.R2_ACCOUNT_ID = 'test-account'
    process.env.R2_ACCESS_KEY_ID = 'test-key'
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret'
    process.env.R2_BUCKET_NAME = 'test-bucket'
    process.env.R2_ENDPOINT = 'https://test.endpoint.com'

    const getStorageEnv = await loadGetStorageEnv()
    const env = getStorageEnv()

    expect(env).toEqual({
      R2_ACCOUNT_ID: 'test-account',
      R2_ACCESS_KEY_ID: 'test-key',
      R2_SECRET_ACCESS_KEY: 'test-secret',
      R2_BUCKET_NAME: 'test-bucket',
      R2_ENDPOINT: 'https://test.endpoint.com'
    })
  })

  it('uses default account ID, endpoint, and bucket when only credentials are set', async () => {
    process.env.R2_ACCESS_KEY_ID = 'test-key'
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret'

    const getStorageEnv = await loadGetStorageEnv()
    const env = getStorageEnv()

    expect(env.R2_ACCOUNT_ID).toBe('dc05faaea8d5f25755d84e55fe3a7d67')
    expect(env.R2_ENDPOINT).toBe('https://dc05faaea8d5f25755d84e55fe3a7d67.r2.cloudflarestorage.com')
    expect(env.R2_BUCKET_NAME).toBe('octospark-dev')
  })

  it('throws in production when credentials are missing', async () => {
    process.env.NODE_ENV = 'production'

    const getStorageEnv = await loadGetStorageEnv()

    expect(() => getStorageEnv()).toThrow(
      'R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set in production and staging environments'
    )
  })

  it('throws in staging when credentials are missing', async () => {
    process.env.NODE_ENV = 'staging'

    const getStorageEnv = await loadGetStorageEnv()

    expect(() => getStorageEnv()).toThrow(
      'R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set in production and staging environments'
    )
  })

  it('throws in development when credentials are missing', async () => {
    process.env.NODE_ENV = 'development'

    const getStorageEnv = await loadGetStorageEnv()

    expect(() => getStorageEnv()).toThrow(
      'R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required'
    )
  })
})
