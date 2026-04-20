'use client'

import type { OrgMemberRole } from '@tx-agent-kit/contracts'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useMyPermissions } from '@/hooks/use-permissions'

export interface RequireRoleProps {
  roles: ReadonlyArray<OrgMemberRole>
  children: ReactNode
  redirectTo: string
}

export function RequireRole({ roles, children, redirectTo }: RequireRoleProps) {
  const { data, isLoading } = useMyPermissions()
  const router = useRouter()
  const role = data?.role ?? null

  useEffect(() => {
    if (!isLoading && role && !roles.includes(role)) {
      router.replace(redirectTo)
    }
  }, [isLoading, role, roles, redirectTo, router])

  if (isLoading) {
    return null
  }
  if (!role || !roles.includes(role)) {
    return null
  }
  return <>{children}</>
}
