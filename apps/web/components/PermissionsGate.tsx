'use client'

import type { PermissionAction } from '@tx-agent-kit/contracts'
import type { ReactNode } from 'react'
import { useHasAnyPermission, useHasPermission } from '@/hooks/use-permissions'

export interface PermissionsGateProps {
  permission?: PermissionAction
  permissions?: ReadonlyArray<PermissionAction>
  fallback?: ReactNode
  children: ReactNode
}

export function PermissionsGate({
  permission,
  permissions,
  fallback = null,
  children
}: PermissionsGateProps) {
  const hasRequiredPermission = permission ? useHasPermission(permission) : true
  const hasRequiredAnyPermission = permissions ? useHasAnyPermission(permissions) : true

  if (!hasRequiredPermission || !hasRequiredAnyPermission) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
