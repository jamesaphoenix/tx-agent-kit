import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseRetryAfterMs, ResendRateLimitedError, sendViaResend } from './resend-sender.js'

const baseInput = {
  apiKey: 'key',
  from: 'from@x.co',
  to: 'to@x.co',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
  idempotencyKey: 'drip:e1:s1'
}

const mockResponse = (init: {
  status: number
  ok: boolean
  retryAfter?: string | null
  body?: unknown
}): Response =>
  ({
    status: init.status,
    ok: init.ok,
    headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? (init.retryAfter ?? null) : null) },
    json: () => Promise.resolve(init.body ?? {}),
    text: () => Promise.resolve(JSON.stringify(init.body ?? {}))
  }) as unknown as Response

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2000)
    expect(parseRetryAfterMs('0')).toBe(0)
  })

  it('returns null for missing or non-numeric/non-date input', () => {
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs('not-a-thing')).toBeNull()
    expect(parseRetryAfterMs('-1')).toBeNull()
  })

  it('parses an HTTP date into a non-negative delay', () => {
    const future = new Date(Date.now() + 5000).toUTCString()
    const ms = parseRetryAfterMs(future)
    expect(ms).not.toBeNull()
    expect(ms ?? 0).toBeGreaterThanOrEqual(0)
  })
})

describe('sendViaResend', () => {
  it('returns the message id on success', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockResponse({ status: 200, ok: true, body: { id: 'msg_1' } }))))
    expect(await sendViaResend(baseInput)).toBe('msg_1')
  })

  it('passes custom headers (List-Unsubscribe) into the Resend request body', async () => {
    let sentBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: { body: string }) => {
        sentBody = JSON.parse(init.body)
        return Promise.resolve(mockResponse({ status: 200, ok: true, body: { id: 'msg_h' } }))
      })
    )
    await sendViaResend({ ...baseInput, headers: { 'List-Unsubscribe': '<https://app.example.com/u?token=t>' } })
    expect(sentBody).toMatchObject({ headers: { 'List-Unsubscribe': '<https://app.example.com/u?token=t>' } })
  })

  it('omits headers from the body when none are provided', async () => {
    let sentBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: { body: string }) => {
        sentBody = JSON.parse(init.body)
        return Promise.resolve(mockResponse({ status: 200, ok: true, body: { id: 'msg_n' } }))
      })
    )
    await sendViaResend(baseInput)
    expect(sentBody).not.toHaveProperty('headers')
  })

  it('throws ResendRateLimitedError on 429 (carrying Retry-After)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockResponse({ status: 429, ok: false, retryAfter: '3' }))))
    const rejection = await sendViaResend(baseInput).catch((error_: unknown) => error_)
    expect(rejection).toBeInstanceOf(ResendRateLimitedError)
    expect((rejection as ResendRateLimitedError).retryAfterMs).toBe(3000)
  })

  it('throws a plain error on other non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(mockResponse({ status: 500, ok: false, body: { error: 'boom' } })))
    )
    await expect(sendViaResend(baseInput)).rejects.toThrow(/Resend request failed \(500\)/)
  })
})
