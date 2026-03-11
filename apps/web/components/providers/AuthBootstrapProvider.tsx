'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { restoreCurrentPrincipal } from '../../lib/client-api'
import { sessionStoreActions } from '../../stores/session-store'

export function AuthBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let active = true

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
