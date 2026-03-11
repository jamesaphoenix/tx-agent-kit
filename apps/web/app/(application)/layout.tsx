'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { readBrowserLocationState } from '../../lib/url-state'
import { ensureSessionOrRedirect } from '../../lib/client-auth'
import { useIsAuthenticated, useIsSessionReady } from '../../hooks/use-session-store'

export default function ApplicationLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isReady = useIsSessionReady()
  const isAuthenticated = useIsAuthenticated()
  const { search } = readBrowserLocationState()
  const nextPath = search.length > 0 ? `${pathname}${search}` : pathname

  useEffect(() => {
    if (!isReady) {
      return
    }

    void ensureSessionOrRedirect(router, nextPath)
  }, [isAuthenticated, isReady, nextPath, router])

  if (!isReady || !isAuthenticated) {
    return null
  }

  return <>{children}</>
}
