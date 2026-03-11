import { describe, expect, it } from 'vitest'
import { permissionActions } from './literals.js'
import {
  getPermissionsForRole,
  renderPermissionReconcileSql,
  rolePermissionMap
} from './permissions.js'

describe('permissions', () => {
  it('grants owners all permissions', () => {
    expect(getPermissionsForRole('owner')).toEqual(permissionActions)
  })

  it('grants admins all permissions', () => {
    expect(getPermissionsForRole('admin')).toEqual(permissionActions)
  })

  it('uses migration-aligned member permissions', () => {
    expect(getPermissionsForRole('member')).toEqual([
      'view_organization',
      'create_teams',
      'view_workflows',
      'create_workflows',
      'edit_workflows',
      'execute_workflows',
      'view_analytics'
    ])
  })

  it('exports the full role permission map', () => {
    expect(Object.keys(rolePermissionMap).sort()).toEqual(['admin', 'member', 'owner'])
  })

  it('renders permission reconcile SQL from the policy', () => {
    const sql = renderPermissionReconcileSql()

    expect(sql).toContain("('owner', 'view_organization')")
    expect(sql).toContain("('admin', 'manage_api_keys')")
    expect(sql).toContain("('member', 'view_analytics')")
    expect(sql).toContain('DELETE FROM role_permissions rp')
    expect(sql).toContain('DELETE FROM permissions')
    expect(sql).not.toContain('organization.read')
  })
})
