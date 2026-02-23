import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { clearAuthToken, readAuthToken } from '../../lib/auth-token'
import { log } from '../../lib/log'
import { clientApi, ApiClientError } from '../../lib/client-api'
import { sessionStoreActions } from '../../stores/session-store'

export function AuthBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let active = true

    const bootstrap = async () => {
      const token = await readAuthToken()

      if (!token) {
        sessionStoreActions.clear()
        return
      }

      try {
        const principal = await clientApi.me()

        if (!active) {
          return
        }

        sessionStoreActions.setPrincipal(principal)
      } catch (err) {
        log.error('Auth bootstrap failed', err)

        if (!active) {
          return
        }

        const isAuthRejection =
          err instanceof ApiClientError && (err.status === 401 || err.status === 403)

        if (isAuthRejection) {
          await clearAuthToken()
        }

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
