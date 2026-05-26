'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { restoreCurrentPrincipal } from '../../lib/client-api'
import { getWebEnv } from '../../lib/env'
import { sessionStoreActions } from '../../stores/session-store'

export function AuthBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let active = true

    if (!getWebEnv().API_BASE_URL) {
      sessionStoreActions.clear()
      return
    }

    const bootstrap = async () => {
      try {
        const principal = await restoreCurrentPrincipal()

        if (!active) {
          return
        }

        if (principal === null) {
          sessionStoreActions.clear()
          return
        }

        sessionStoreActions.setPrincipal(principal)
      } catch {
        if (!active) {
          return
        }

        sessionStoreActions.clear()
      }
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [])

  return <>{children}</>
}
