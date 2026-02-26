import { describe, expect, it } from 'vitest'
import { permissionActions } from './literals.js'
import { getPermissionsForRole, rolePermissionMap } from './permissions.js'

describe('permissions', () => {
  it('grants owners all permissions', () => {
    expect(getPermissionsForRole('owner')).toEqual(permissionActions)
  })

  it('grants admins all permissions except manage_organization', () => {
    const adminPermissions = getPermissionsForRole('admin')
    expect(adminPermissions).not.toContain('manage_organization')
    expect(adminPermissions).toContain('manage_billing')
    expect(adminPermissions.length).toBe(permissionActions.length - 1)
  })

  it('uses scoped member permissions', () => {
    expect(getPermissionsForRole('member')).toEqual([
      'view_organization',
      'view_workflows',
      'execute_workflows',
      'view_analytics'
    ])
  })

  it('exports the full role permission map', () => {
    expect(Object.keys(rolePermissionMap).sort()).toEqual(['admin', 'member', 'owner'])
  })
})
