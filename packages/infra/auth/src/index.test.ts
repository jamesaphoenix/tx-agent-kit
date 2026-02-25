import { describe, expect, it, beforeEach } from 'vitest'
import { Effect } from 'effect'
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from './index.js'

describe('auth primitives', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'local-dev-auth-secret-12345'
    process.env.AUTH_BCRYPT_ROUNDS = '4'
  })

  it('hashes and verifies password', async () => {
    const hash = await Effect.runPromise(hashPassword('strong-password'))
    const ok = await Effect.runPromise(verifyPassword('strong-password', hash))
    expect(ok).toBe(true)
  })

  it('signs and verifies token', async () => {
    const token = await Effect.runPromise(
      signSessionToken({
        sub: '11111111-1111-1111-1111-111111111111',
        email: 'x@example.com',
        pwd: Date.now()
      })
    )
    const payload = await Effect.runPromise(verifySessionToken(token))
    expect(payload.email).toBe('x@example.com')
    expect(payload.sub).toBe('11111111-1111-1111-1111-111111111111')
    expect(typeof payload.pwd).toBe('number')
  })
})
