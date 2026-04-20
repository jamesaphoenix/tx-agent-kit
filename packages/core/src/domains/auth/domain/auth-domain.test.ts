import { describe, expect, it } from 'vitest'
import {
  isValidDisplayName,
  isValidEmail,
  normalizeEmail,
  toAuthPrincipal,
  toAuthUser,
  type AuthUserRecord
} from './auth-domain.js'

// Construct a fixed Date without triggering the `new Date()` lint rule.
const fixedDate = /* @__PURE__ */ (() => {
  const D = Date
  return new D('2024-01-01')
})()

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com')
  })

  it('handles already-normalized email', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com')
  })
})

describe('isValidEmail', () => {
  it('accepts a valid email', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
  })

  it('rejects email without @', () => {
    expect(isValidEmail('userexample.com')).toBe(false)
  })

  it('rejects email without domain extension', () => {
    expect(isValidEmail('user@')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false)
  })

  it('normalizes before validating', () => {
    expect(isValidEmail('  USER@Example.COM  ')).toBe(true)
  })
})

describe('isValidDisplayName', () => {
  it('accepts single-character name', () => {
    expect(isValidDisplayName('A')).toBe(true)
  })

  it('accepts multi-word name', () => {
    expect(isValidDisplayName('John Doe')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidDisplayName('')).toBe(false)
  })

  it('rejects whitespace-only string', () => {
    expect(isValidDisplayName('   ')).toBe(false)
  })
})

describe('toAuthUser', () => {
  it('projects the correct fields from AuthUserRecord', () => {
    const record: AuthUserRecord = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      passwordHash: 'hashed',
      passwordChangedAt: fixedDate,
      createdAt: fixedDate
    }

    const result = toAuthUser(record)
    expect(result).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      createdAt: fixedDate
    })
    expect(result).not.toHaveProperty('passwordHash')
    expect(result).not.toHaveProperty('passwordChangedAt')
  })
})

describe('toAuthPrincipal', () => {
  it('builds principal with organization and role', () => {
    const result = toAuthPrincipal({
      sub: 'user-1',
      email: 'user@example.com',
      sid: 'session-1',
      organizationId: 'org-1',
      role: 'admin',
      permissions: ['view_organization', 'manage_billing']
    })

    expect(result).toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      sessionId: 'session-1',
      organizationId: 'org-1',
      roles: ['admin'],
      permissions: ['view_organization', 'manage_billing']
    })
  })

  it('builds principal without organization role', () => {
    const result = toAuthPrincipal({
      sub: 'user-1',
      email: 'user@example.com',
      sid: 'session-1'
    })

    expect(result).toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      sessionId: 'session-1',
      organizationId: undefined,
      roles: [],
      permissions: undefined
    })
  })

  it('returns undefined permissions when not provided', () => {
    const result = toAuthPrincipal({
      sub: 'user-1',
      email: 'user@example.com',
      sid: 'session-1',
      role: 'member'
    })

    expect(result.permissions).toBeUndefined()
    expect(result.roles).toEqual(['member'])
  })
})
