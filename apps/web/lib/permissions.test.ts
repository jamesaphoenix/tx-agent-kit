import type { AuthPrincipal } from '@tx-agent-kit/contracts'
import { describe, expect, it } from 'vitest'
import { hasAllPermissions, hasAnyPermission, hasPermission } from './permissions'

const principal: AuthPrincipal = {
  userId: 'user-1',
  email: 'user@example.com',
  organizationId: 'org-1',
  roles: ['member'],
  permissions: ['view_organization', 'execute_workflows']
}

describe('permissions utilities', () => {
  it('checks single permissions', () => {
    expect(hasPermission(principal, 'view_organization')).toBe(true)
    expect(hasPermission(principal, 'manage_billing')).toBe(false)
  })

  it('checks any-of permissions', () => {
    expect(hasAnyPermission(principal, ['manage_billing', 'execute_workflows'])).toBe(true)
    expect(hasAnyPermission(principal, ['manage_billing', 'manage_api_keys'])).toBe(false)
  })

  it('checks all permissions', () => {
    expect(hasAllPermissions(principal, ['view_organization', 'execute_workflows'])).toBe(true)
    expect(hasAllPermissions(principal, ['view_organization', 'manage_billing'])).toBe(false)
  })
})
