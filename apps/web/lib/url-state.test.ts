import { describe, expect, it } from 'vitest'
import { sanitizeInternalPath } from './url-state'

describe('sanitizeInternalPath', () => {
  it('returns a valid internal path starting with /', () => {
    expect(sanitizeInternalPath('/dashboard', '/fallback')).toBe('/dashboard')
  })

  it('returns fallback for null', () => {
    expect(sanitizeInternalPath(null, '/fallback')).toBe('/fallback')
  })

  it('returns fallback for relative paths', () => {
    expect(sanitizeInternalPath('dashboard', '/fallback')).toBe('/fallback')
  })

  it('rejects protocol-relative URLs (open redirect)', () => {
    expect(sanitizeInternalPath('//evil.com', '/fallback')).toBe('/fallback')
  })

  it('rejects protocol-relative URLs with paths', () => {
    expect(sanitizeInternalPath('//evil.com/steal-cookies', '/fallback')).toBe('/fallback')
  })

  it('allows deeply nested internal paths', () => {
    expect(sanitizeInternalPath('/a/b/c?q=1', '/fallback')).toBe('/a/b/c?q=1')
  })
})
