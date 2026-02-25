import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAuthEnv } from './env.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getAuthEnv', () => {
  it('returns defaults when auth env vars are unset', () => {
    vi.stubEnv('AUTH_SECRET', undefined)
    vi.stubEnv('AUTH_BCRYPT_ROUNDS', undefined)

    expect(getAuthEnv()).toEqual({
      AUTH_SECRET: '',
      AUTH_BCRYPT_ROUNDS: 12
    })
  })

  it('accepts bcrypt rounds in the supported range', () => {
    vi.stubEnv('AUTH_SECRET', 'secret')
    vi.stubEnv('AUTH_BCRYPT_ROUNDS', '15')

    expect(getAuthEnv()).toEqual({
      AUTH_SECRET: 'secret',
      AUTH_BCRYPT_ROUNDS: 15
    })
  })

  it('falls back to defaults for invalid bcrypt rounds', () => {
    vi.stubEnv('AUTH_SECRET', 'secret')
    vi.stubEnv('AUTH_BCRYPT_ROUNDS', '3')
    expect(getAuthEnv().AUTH_BCRYPT_ROUNDS).toBe(12)

    vi.stubEnv('AUTH_BCRYPT_ROUNDS', 'abc')
    expect(getAuthEnv().AUTH_BCRYPT_ROUNDS).toBe(12)
  })
})
