import { describe, expect, it } from 'vitest'
import { isUuid, NIL_UUID } from './id-validation'

describe('isUuid', () => {
  it('accepts a canonical lowercase UUID', () => {
    expect(isUuid('11111111-2222-4333-8444-555555555555')).toBe(true)
  })

  it('accepts an uppercase UUID', () => {
    expect(isUuid('11111111-2222-4333-8444-555555555555'.toUpperCase())).toBe(true)
  })

  it('treats the nil UUID as a valid placeholder', () => {
    expect(isUuid(NIL_UUID)).toBe(true)
  })

  it('rejects a transient/malformed route segment', () => {
    expect(isUuid('')).toBe(false)
    expect(isUuid('not-a-uuid')).toBe(false)
    // Missing the final group - a partially-typed/encoded route param.
    expect(isUuid('11111111-2222-4333-8444')).toBe(false)
    expect(isUuid('11111111-2222-4333-8444-555555555555-extra')).toBe(false)
  })
})
