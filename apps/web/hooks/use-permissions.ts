'use client'

import type { AuthPrincipal, OrgMemberRole, PermissionAction } from '@tx-agent-kit/contracts'
import { usePermissionsGetPermissionMap, usePermissionsGetMyPermissions } from '@/lib/api/generated/permissions/permissions'
import type { PermissionsGetMyPermissions200 } from '@/lib/api/generated/schemas/permissionsGetMyPermissions200'
import { hasAnyPermission, hasPermission } from '@/lib/permissions'
import { useCurrentPrincipal } from './use-session-store'

export interface MyPermissionsResult {
  organizationId?: string
  role?: OrgMemberRole
  permissions: PermissionAction[]
}

export const usePermissionMap = () =>
  usePermissionsGetPermissionMap({ query: { staleTime: 60_000 } })

const principalPermissionsInitialData = (principal: AuthPrincipal | null): PermissionsGetMyPermissions200 | undefined => {
  if (principal === null) {
    return undefined
  }

  const role = principal.roles[0]
  return {
    ...(principal.organizationId ? { organizationId: principal.organizationId } : {}),
    ...(role ? { role } : {}),
    isOwner: false,
    permissions: [...principal.permissions]
  }
}

export const useMyPermissions = () => {
  const principal = useCurrentPrincipal()
  const initialData = principalPermissionsInitialData(principal)

  return usePermissionsGetMyPermissions<PermissionsGetMyPermissions200 | undefined>({
    query: {
      enabled: principal !== null,
      staleTime: 15_000,
      ...(initialData ? { initialData } : {})
    }
  })
}

export const useHasPermission = (permission: PermissionAction): boolean => {
  const principal = useCurrentPrincipal()
  const myPermissionsQuery = useMyPermissions()

  const permissions = (myPermissionsQuery.data?.permissions ?? principal?.permissions ?? []) as PermissionAction[]
  const principalForCheck = principal ? { ...principal, permissions } : null
  return hasPermission(principalForCheck, permission)
}

export const useHasAnyPermission = (permissions: ReadonlyArray<PermissionAction>): boolean => {
  const principal = useCurrentPrincipal()
  const myPermissionsQuery = useMyPermissions()

  const resolvedPermissions = (myPermissionsQuery.data?.permissions ?? principal?.permissions ?? []) as PermissionAction[]
  const principalForCheck = principal ? { ...principal, permissions: resolvedPermissions } : null
  return hasAnyPermission(principalForCheck, permissions)
}
