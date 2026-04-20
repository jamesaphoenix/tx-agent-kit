import * as Schema from 'effect/Schema'
import { memberRoles, orgMemberRoles, permissionActions, type MemberRole, type PermissionAction } from './literals.js'

export const permissionActionSchema = Schema.Literal(...permissionActions)
export const orgMemberRoleSchema = Schema.Literal(...orgMemberRoles)

const allPermissions = [...permissionActions] as const satisfies ReadonlyArray<PermissionAction>

export type RolePermissionPolicyEntry =
  | { readonly mode: 'all' }
  | { readonly mode: 'all_except'; readonly exclude: ReadonlyArray<PermissionAction> }
  | { readonly mode: 'explicit'; readonly include: ReadonlyArray<PermissionAction> }

export const rolePermissionPolicy = {
  admin: {
    mode: 'all'
  },
  member: {
    mode: 'all_except',
    exclude: [
      'manage_organization',
      'manage_organization_members',
      'manage_billing',
      'manage_team_members',
      'assign_roles',
      'delete_teams',
      'delete_workflows',
      'export_analytics',
      'manage_integrations',
      'manage_api_keys',
      'manage_assets',
      'delete_assets'
    ]
  },
  viewer: {
    mode: 'explicit',
    include: [
      'view_organization',
      'view_workflows',
      'view_analytics',
      'view_assets'
    ]
  }
} as const satisfies Record<MemberRole, RolePermissionPolicyEntry>

const resolveRolePermissions = (
  entry: RolePermissionPolicyEntry
): ReadonlyArray<PermissionAction> => {
  switch (entry.mode) {
    case 'all':
      return allPermissions
    case 'all_except': {
      const excludedPermissions = new Set(entry.exclude)
      return allPermissions.filter((permission) => !excludedPermissions.has(permission))
    }
    case 'explicit':
      return entry.include
  }
}

const quoteSqlLiteral = (value: string): string => `'${value.replaceAll('\'', '\'\'')}'`

const renderSqlValues = (values: ReadonlyArray<string>): string =>
  values.map((value) => `  (${quoteSqlLiteral(value)})`).join(',\n')

const renderSqlTupleValues = (rows: ReadonlyArray<ReadonlyArray<string>>): string =>
  rows.map((row) => `  (${row.map((value) => quoteSqlLiteral(value)).join(', ')})`).join(',\n')

const buildRolePermissionMap = (
  policy: Record<MemberRole, RolePermissionPolicyEntry>
): Record<MemberRole, ReadonlyArray<PermissionAction>> => ({
  admin: resolveRolePermissions(policy.admin),
  member: resolveRolePermissions(policy.member),
  viewer: resolveRolePermissions(policy.viewer)
})

export const rolePermissionMap: Record<MemberRole, ReadonlyArray<PermissionAction>> = {
  ...buildRolePermissionMap(rolePermissionPolicy)
}

export const getPermissionsForRole = (role: MemberRole): ReadonlyArray<PermissionAction> =>
  rolePermissionMap[role]

// ---------------------------------------------------------------------------
// Team-level permission policy (uses unified MemberRole)
// ---------------------------------------------------------------------------

export const teamRolePermissionPolicy = {
  admin: { mode: 'all' },
  member: {
    mode: 'all_except',
    exclude: [
      'manage_organization',
      'manage_organization_members',
      'manage_billing',
      'manage_team_members',
      'assign_roles',
      'delete_teams',
      'manage_integrations',
      'manage_api_keys'
    ]
  },
  viewer: {
    mode: 'explicit',
    include: [
      'view_organization',
      'view_workflows',
      'view_analytics',
      'view_assets'
    ]
  }
} as const satisfies Record<MemberRole, RolePermissionPolicyEntry>

export const teamRolePermissionMap: Record<MemberRole, ReadonlyArray<PermissionAction>> = {
  admin: resolveRolePermissions(teamRolePermissionPolicy.admin),
  member: resolveRolePermissions(teamRolePermissionPolicy.member),
  viewer: resolveRolePermissions(teamRolePermissionPolicy.viewer),
}

export const getPermissionsForTeamRole = (role: MemberRole): ReadonlyArray<PermissionAction> =>
  teamRolePermissionMap[role]

export const memberRoleSchema = Schema.Literal(...memberRoles)

const desiredRolePermissionRows = memberRoles.flatMap((role) =>
  rolePermissionMap[role].map((permission) => [role, permission] as const)
)

export const renderPermissionReconcileSql = (): string =>
  [
    '-- Generated from packages/contracts/src/permissions.ts.',
    '-- Update rolePermissionPolicy and regenerate when policy changes.',
    '',
    'INSERT INTO roles (name)',
    'VALUES',
    renderSqlValues(memberRoles),
    'ON CONFLICT (name) DO NOTHING;',
    '',
    'INSERT INTO permissions (key)',
    'VALUES',
    renderSqlValues(permissionActions),
    'ON CONFLICT (key) DO NOTHING;',
    '',
    'WITH desired_role_permissions(role_name, permission_key) AS (',
    '  VALUES',
    renderSqlTupleValues(desiredRolePermissionRows),
    ')',
    'INSERT INTO role_permissions (role_id, permission_id)',
    'SELECT r.id, p.id',
    'FROM desired_role_permissions desired',
    'JOIN roles r',
    '  ON r.name = desired.role_name',
    'JOIN permissions p',
    '  ON p.key = desired.permission_key',
    'ON CONFLICT DO NOTHING;',
    '',
    'WITH desired_role_permissions(role_name, permission_key) AS (',
    '  VALUES',
    renderSqlTupleValues(desiredRolePermissionRows),
    ')',
    'DELETE FROM role_permissions rp',
    'USING roles r, permissions p',
    'WHERE rp.role_id = r.id',
    '  AND rp.permission_id = p.id',
    `  AND r.name IN (${memberRoles.map((role) => quoteSqlLiteral(role)).join(', ')})`,
    '  AND NOT EXISTS (',
    '    SELECT 1',
    '    FROM desired_role_permissions desired',
    '    WHERE desired.role_name = r.name',
    '      AND desired.permission_key = p.key',
    '  );',
    '',
    'DELETE FROM permissions',
    `WHERE key NOT IN (${permissionActions.map((permission) => quoteSqlLiteral(permission)).join(', ')})`,
    '  AND NOT EXISTS (',
    '    SELECT 1',
    '    FROM role_permissions rp',
    '    WHERE rp.permission_id = permissions.id',
    '  );'
  ].join('\n')

export const myPermissionsResponseSchema = Schema.Struct({
  organizationId: Schema.optional(Schema.String),
  role: Schema.optional(memberRoleSchema),
  isOwner: Schema.Boolean,
  permissions: Schema.Array(permissionActionSchema)
})

export const rolePermissionMapSchema = Schema.Record({
  key: memberRoleSchema,
  value: Schema.Array(permissionActionSchema)
})

export type MyPermissionsResponse = Schema.Schema.Type<typeof myPermissionsResponseSchema>
