import * as Schema from 'effect/Schema'
import { orgMemberRoles, permissionActions, type OrgMemberRole, type PermissionAction } from './literals.js'

export const permissionActionSchema = Schema.Literal(...permissionActions)
export const orgMemberRoleSchema = Schema.Literal(...orgMemberRoles)

const allPermissions = [...permissionActions] as const satisfies ReadonlyArray<PermissionAction>

const adminPermissions = allPermissions.filter((permission) => permission !== 'manage_organization')

const memberPermissions: ReadonlyArray<PermissionAction> = [
  'view_organization',
  'view_workflows',
  'execute_workflows',
  'view_analytics'
]

export const rolePermissionMap: Record<OrgMemberRole, ReadonlyArray<PermissionAction>> = {
  owner: allPermissions,
  admin: adminPermissions,
  member: memberPermissions
}

export const getPermissionsForRole = (role: OrgMemberRole): ReadonlyArray<PermissionAction> =>
  rolePermissionMap[role] ?? []

export const rolePermissionMapSchema = Schema.Record({
  key: orgMemberRoleSchema,
  value: Schema.Array(permissionActionSchema)
})
