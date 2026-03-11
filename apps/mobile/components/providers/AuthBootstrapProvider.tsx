import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { log } from '../../lib/log'
import { restoreCurrentPrincipal } from '../../lib/client-api'
import { sessionStoreActions } from '../../stores/session-store'

export function AuthBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const guard = { active: true }
    const isActive = (): boolean => guard.active

    const bootstrap = async () => {
      try {
        const principal = await restoreCurrentPrincipal()

        if (!isActive()) {
          return
        }

        if (principal === null) {
          sessionStoreActions.clear()
          return
        }

        sessionStoreActions.setPrincipal(principal)
      } catch (error) {
        log.error('Auth bootstrap failed', error)

        if (!isActive()) {
          return
        }

        sessionStoreActions.clear()
      }
    }

    void bootstrap()

    return () => {
      guard.active = false
    }
  }, [])

  return <>{children}</>
}
