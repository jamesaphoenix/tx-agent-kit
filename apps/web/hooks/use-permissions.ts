'use client'

import { useQuery } from '@tanstack/react-query'
import type { OrgMemberRole, PermissionAction } from '@tx-agent-kit/contracts'
import { clientApi } from '@/lib/client-api'
import { hasAnyPermission, hasPermission } from '@/lib/permissions'
import { useCurrentPrincipal } from './use-session-store'

export interface MyPermissionsResult {
  organizationId?: string
  role?: OrgMemberRole
  permissions: PermissionAction[]
}

export const usePermissionMap = () =>
  useQuery({
    queryKey: ['permissions', 'map'],
    queryFn: () => clientApi.getPermissionMap(),
    staleTime: 60_000
  })

export const useMyPermissions = () => {
  const principal = useCurrentPrincipal()

  return useQuery({
    queryKey: ['permissions', 'me'],
    queryFn: () => clientApi.getMyPermissions(),
    enabled: principal !== null,
    staleTime: 15_000
  })
}

export const useHasPermission = (permission: PermissionAction): boolean => {
  const principal = useCurrentPrincipal()
  const myPermissionsQuery = useMyPermissions()

  const permissions = myPermissionsQuery.data?.permissions ?? principal?.permissions ?? []
  const principalForCheck = principal ? { ...principal, permissions } : null
  return hasPermission(principalForCheck, permission)
}

export const useHasAnyPermission = (permissions: ReadonlyArray<PermissionAction>): boolean => {
  const principal = useCurrentPrincipal()
  const myPermissionsQuery = useMyPermissions()

  const resolvedPermissions = myPermissionsQuery.data?.permissions ?? principal?.permissions ?? []
  const principalForCheck = principal ? { ...principal, permissions: resolvedPermissions } : null
  return hasAnyPermission(principalForCheck, permissions)
}
