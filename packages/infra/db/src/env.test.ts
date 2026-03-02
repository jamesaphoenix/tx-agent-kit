import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDbEnv } from './env.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getDbEnv', () => {
  it('returns DATABASE_URL from environment when set', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://custom:custom@db:5432/mydb')

    expect(getDbEnv()).toEqual({
      DATABASE_URL: 'postgres://custom:custom@db:5432/mydb'
    })
  })

  it('returns default URL when DATABASE_URL is unset in development', () => {
    vi.stubEnv('DATABASE_URL', undefined)
    vi.stubEnv('NODE_ENV', 'development')

    expect(getDbEnv()).toEqual({
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'
    })
  })

  it('returns default URL when NODE_ENV is unset', () => {
    vi.stubEnv('DATABASE_URL', undefined)
    vi.stubEnv('NODE_ENV', undefined)

    expect(getDbEnv()).toEqual({
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'
    })
  })

  it('throws when DATABASE_URL is unset in production', () => {
    vi.stubEnv('DATABASE_URL', undefined)
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => getDbEnv()).toThrow(
      'DATABASE_URL must be set in production and staging environments'
    )
  })

  it('throws when DATABASE_URL is unset in staging', () => {
    vi.stubEnv('DATABASE_URL', undefined)
    vi.stubEnv('NODE_ENV', 'staging')

    expect(() => getDbEnv()).toThrow(
      'DATABASE_URL must be set in production and staging environments'
    )
  })

  it('allows explicit DATABASE_URL in production', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://prod:prod@prod-db:5432/proddb')
    vi.stubEnv('NODE_ENV', 'production')

    expect(getDbEnv()).toEqual({
      DATABASE_URL: 'postgres://prod:prod@prod-db:5432/proddb'
    })
  })
})
