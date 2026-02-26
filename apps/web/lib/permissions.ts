import type { AuthPrincipal, PermissionAction } from '@tx-agent-kit/contracts'

const toPermissionSet = (principal: AuthPrincipal | null | undefined): ReadonlySet<PermissionAction> => {
  const permissions = principal?.permissions ?? []
  return new Set<PermissionAction>(permissions)
}

export const hasPermission = (
  principal: AuthPrincipal | null | undefined,
  permission: PermissionAction
): boolean => toPermissionSet(principal).has(permission)

export const hasAnyPermission = (
  principal: AuthPrincipal | null | undefined,
  permissions: ReadonlyArray<PermissionAction>
): boolean => {
  const permissionSet = toPermissionSet(principal)
  return permissions.some((permission) => permissionSet.has(permission))
}

export const hasAllPermissions = (
  principal: AuthPrincipal | null | undefined,
  permissions: ReadonlyArray<PermissionAction>
): boolean => {
  const permissionSet = toPermissionSet(principal)
  return permissions.every((permission) => permissionSet.has(permission))
}
