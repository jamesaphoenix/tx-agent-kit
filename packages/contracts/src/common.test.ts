import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, type CursorPayload } from './common.js'

describe('cursor helpers', () => {
  it('round-trips a cursor payload', () => {
    const payload: CursorPayload = {
      v: 1,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      sortValue: '2026-02-23T00:00:00.000Z',
      id: 'task-123'
    }

    const encoded = encodeCursor(payload)

    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
    expect(decodeCursor(encoded)).toEqual(payload)
  })

  it('returns null when cursor is not valid base64url JSON', () => {
    expect(decodeCursor('%%%not-a-cursor%%%')).toBeNull()
  })

  it('returns null when decoded payload shape is invalid', () => {
    const malformed = Buffer.from(
      JSON.stringify({
        v: 1,
        sortBy: 'createdAt'
      }),
      'utf8'
    ).toString('base64url')

    expect(decodeCursor(malformed)).toBeNull()
  })
})
