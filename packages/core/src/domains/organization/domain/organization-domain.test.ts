import { describe, expect, it } from 'vitest'
import {
  canCreateInvitation,
  canDeleteOrganization,
  canManageInvitation,
  canManageMembers,
  canManageOrganization,
  isValidInvitationEmail,
  isValidInvitationRoleUpdate,
  isValidInvitationStatusUpdate,
  isValidOrganizationName,
  normalizeInvitationEmail,
  normalizeOrganizationName
} from './organization-domain.js'

describe('normalizeInvitationEmail', () => {
  it('lowercases and trims email', () => {
    expect(normalizeInvitationEmail('  USER@Example.COM  ')).toBe('user@example.com')
  })

  it('handles already-normalized email', () => {
    expect(normalizeInvitationEmail('user@example.com')).toBe('user@example.com')
  })
})

describe('isValidInvitationEmail', () => {
  it('accepts a valid email', () => {
    expect(isValidInvitationEmail('user@example.com')).toBe(true)
  })

  it('rejects email without @', () => {
    expect(isValidInvitationEmail('userexample.com')).toBe(false)
  })

  it('rejects email without domain', () => {
    expect(isValidInvitationEmail('user@')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidInvitationEmail('')).toBe(false)
  })

  it('accepts email with leading/trailing whitespace (normalizes first)', () => {
    expect(isValidInvitationEmail('  user@example.com  ')).toBe(true)
  })
})

describe('normalizeOrganizationName', () => {
  it('trims whitespace', () => {
    expect(normalizeOrganizationName('  My Org  ')).toBe('My Org')
  })
})

describe('isValidOrganizationName', () => {
  it('accepts names between 2 and 64 characters', () => {
    expect(isValidOrganizationName('AB')).toBe(true)
    expect(isValidOrganizationName('A'.repeat(64))).toBe(true)
  })

  it('rejects single-character names', () => {
    expect(isValidOrganizationName('A')).toBe(false)
  })

  it('rejects empty names', () => {
    expect(isValidOrganizationName('')).toBe(false)
    expect(isValidOrganizationName('   ')).toBe(false)
  })

  it('rejects names longer than 64 characters', () => {
    expect(isValidOrganizationName('A'.repeat(65))).toBe(false)
  })

  it('trims before checking length', () => {
    expect(isValidOrganizationName('  AB  ')).toBe(true)
    expect(isValidOrganizationName('  A  ')).toBe(false)
  })
})

describe('role-based permission guards', () => {
  describe('canCreateInvitation', () => {
    it('allows admin', () => expect(canCreateInvitation('admin')).toBe(true))
    it('denies member', () => expect(canCreateInvitation('member')).toBe(false))
    it('denies viewer', () => expect(canCreateInvitation('viewer')).toBe(false))
  })

  describe('canManageOrganization', () => {
    it('allows admin', () => expect(canManageOrganization('admin')).toBe(true))
    it('denies member', () => expect(canManageOrganization('member')).toBe(false))
    it('denies viewer', () => expect(canManageOrganization('viewer')).toBe(false))
  })

  describe('canDeleteOrganization', () => {
    it('allows admin', () => expect(canDeleteOrganization('admin')).toBe(true))
    it('denies member', () => expect(canDeleteOrganization('member')).toBe(false))
    it('denies viewer', () => expect(canDeleteOrganization('viewer')).toBe(false))
  })

  describe('canManageInvitation', () => {
    it('allows admin', () => expect(canManageInvitation('admin')).toBe(true))
    it('denies member', () => expect(canManageInvitation('member')).toBe(false))
    it('denies viewer', () => expect(canManageInvitation('viewer')).toBe(false))
  })

  describe('canManageMembers', () => {
    it('allows admin', () => expect(canManageMembers('admin')).toBe(true))
    it('denies member', () => expect(canManageMembers('member')).toBe(false))
    it('denies viewer', () => expect(canManageMembers('viewer')).toBe(false))
  })
})

describe('isValidInvitationRoleUpdate', () => {
  it('accepts undefined (no role change)', () => {
    expect(isValidInvitationRoleUpdate(undefined)).toBe(true)
  })

  it('accepts admin', () => {
    expect(isValidInvitationRoleUpdate('admin')).toBe(true)
  })

  it('accepts member', () => {
    expect(isValidInvitationRoleUpdate('member')).toBe(true)
  })

  it('rejects viewer (not an assignable role)', () => {
    expect(isValidInvitationRoleUpdate('viewer')).toBe(false)
  })

  it('rejects arbitrary strings', () => {
    expect(isValidInvitationRoleUpdate('superadmin')).toBe(false)
  })
})

describe('isValidInvitationStatusUpdate', () => {
  it('accepts undefined (no status change)', () => {
    expect(isValidInvitationStatusUpdate(undefined)).toBe(true)
  })

  it('accepts pending', () => {
    expect(isValidInvitationStatusUpdate('pending')).toBe(true)
  })

  it('accepts accepted', () => {
    expect(isValidInvitationStatusUpdate('accepted')).toBe(true)
  })

  it('accepts revoked', () => {
    expect(isValidInvitationStatusUpdate('revoked')).toBe(true)
  })

  it('accepts expired', () => {
    expect(isValidInvitationStatusUpdate('expired')).toBe(true)
  })

  it('rejects arbitrary strings', () => {
    expect(isValidInvitationStatusUpdate('deleted')).toBe(false)
  })
})
