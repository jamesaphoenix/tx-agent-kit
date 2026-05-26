'use client'

import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'
import { useIsAuthenticated, useIsSessionReady } from '@/hooks/use-session-store'
import { ensureSessionOrRedirect } from '@/lib/client-auth'
import { readBrowserLocationState } from '@/lib/url-state'
import { PageLoadingSpinner } from './PageLoadingSpinner'

const currentNextPath = (pathname: string): string => {
  const search = readBrowserLocationState().search
  return `${pathname}${search}`
}

export function ProtectedClientRoute({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isReady = useIsSessionReady()
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    if (!isReady || isAuthenticated || pathname.startsWith('/sign-in')) {
      return
    }

    ensureSessionOrRedirect(router, currentNextPath(pathname))
  }, [isAuthenticated, isReady, pathname, router])

  if (!isReady || !isAuthenticated) {
    return <PageLoadingSpinner label="Checking session" />
  }

  return <>{children}</>
}
