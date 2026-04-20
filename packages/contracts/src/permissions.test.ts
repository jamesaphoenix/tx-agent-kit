import { describe, expect, it } from 'vitest'
import { permissionActions } from './literals.js'
import {
  getPermissionsForRole,
  getPermissionsForTeamRole,
  renderPermissionReconcileSql,
  rolePermissionMap,
  teamRolePermissionMap
} from './permissions.js'

describe('permissions', () => {
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
      'view_analytics',
      'view_assets',
      'upload_assets'
    ])
  })

  it('grants viewer only view_* permissions', () => {
    expect(getPermissionsForRole('viewer')).toEqual([
      'view_organization',
      'view_workflows',
      'view_analytics',
      'view_assets'
    ])
  })

  it('exports the full role permission map', () => {
    expect(Object.keys(rolePermissionMap).sort()).toEqual(['admin', 'member', 'viewer'])
  })

  it('renders permission reconcile SQL from the policy', () => {
    const sql = renderPermissionReconcileSql()

    expect(sql).toContain("('admin', 'manage_api_keys')")
    expect(sql).toContain("('member', 'view_analytics')")
    expect(sql).toContain("('viewer', 'view_organization')")
    expect(sql).toContain('DELETE FROM role_permissions rp')
    expect(sql).toContain('DELETE FROM permissions')
    expect(sql).not.toContain('organization.read')
    expect(sql).not.toContain("'owner'")
  })
})

describe('team permissions', () => {
  it('grants team admin all permissions', () => {
    expect(getPermissionsForTeamRole('admin')).toEqual(permissionActions)
  })

  it('grants team member all except manage/assign/delete-teams/integrations/api-keys permissions', () => {
    const memberPerms = getPermissionsForTeamRole('member')

    expect(memberPerms).not.toContain('manage_organization')
    expect(memberPerms).not.toContain('manage_organization_members')
    expect(memberPerms).not.toContain('manage_billing')
    expect(memberPerms).not.toContain('manage_team_members')
    expect(memberPerms).not.toContain('assign_roles')
    expect(memberPerms).not.toContain('delete_teams')
    expect(memberPerms).not.toContain('manage_integrations')
    expect(memberPerms).not.toContain('manage_api_keys')
  })

  it('allows team member to delete_assets, upload_assets, and create_teams', () => {
    const memberPerms = getPermissionsForTeamRole('member')

    expect(memberPerms).toContain('delete_assets')
    expect(memberPerms).toContain('upload_assets')
    expect(memberPerms).toContain('create_teams')
  })

  it('grants team viewer only view_* permissions', () => {
    const viewerPerms = getPermissionsForTeamRole('viewer')

    expect(viewerPerms).toEqual([
      'view_organization',
      'view_workflows',
      'view_analytics',
      'view_assets'
    ])
  })

  it('denies viewer upload_assets and delete_assets', () => {
    const viewerPerms = getPermissionsForTeamRole('viewer')

    expect(viewerPerms).not.toContain('upload_assets')
    expect(viewerPerms).not.toContain('delete_assets')
  })

  it('exports the full team role permission map', () => {
    expect(Object.keys(teamRolePermissionMap).sort()).toEqual(['admin', 'member', 'viewer'])
  })
})
