import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySentryHmac } from './sentry-webhook-verification.js'

const secret = 'test-sentry-secret'
const sign = (payload: string, withSecret = secret): string =>
  createHmac('sha256', withSecret).update(payload, 'utf8').digest('hex')

describe('verifySentryHmac', () => {
  it('accepts a correctly signed payload', () => {
    const payload = JSON.stringify({ data: { issue: { id: '1' } } })
    expect(verifySentryHmac(payload, sign(payload), secret)).toBe(true)
  })

  it('accepts an uppercase hex signature (case-insensitive)', () => {
    const payload = 'body'
    expect(verifySentryHmac(payload, sign(payload).toUpperCase(), secret)).toBe(true)
  })

  it('rejects a signature produced with a different secret', () => {
    const payload = 'body'
    expect(verifySentryHmac(payload, sign(payload, 'other-secret'), secret)).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const payload = 'body'
    const signature = sign(payload)
    expect(verifySentryHmac('body-tampered', signature, secret)).toBe(false)
  })

  it('rejects a non-hex / malformed signature', () => {
    expect(verifySentryHmac('body', 'not-a-hex-signature', secret)).toBe(false)
  })

  it('rejects an empty signature', () => {
    expect(verifySentryHmac('body', '', secret)).toBe(false)
  })

  it('rejects when the secret is empty', () => {
    const payload = 'body'
    expect(verifySentryHmac(payload, sign(payload), '')).toBe(false)
  })
})
