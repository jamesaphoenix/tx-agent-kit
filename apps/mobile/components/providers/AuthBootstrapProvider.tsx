import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { clearAuthToken, readAuthToken } from '../../lib/auth-token'
import { log } from '../../lib/log'
import { clientApi, ApiClientError } from '../../lib/client-api'
import { sessionStoreActions } from '../../stores/session-store'

export function AuthBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const guard = { active: true }
    const isActive = (): boolean => guard.active

    const bootstrap = async () => {
      const token = await readAuthToken()

      if (!token) {
        sessionStoreActions.clear()
        return
      }

      try {
        const principal = await clientApi.me()

        if (!isActive()) {
          return
        }

        sessionStoreActions.setPrincipal(principal)
      } catch (error) {
        log.error('Auth bootstrap failed', error)

        if (!isActive()) {
          return
        }

        const isAuthRejection =
          error instanceof ApiClientError && (error.status === 401 || error.status === 403)

        if (isAuthRejection) {
          await clearAuthToken()
        }

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
