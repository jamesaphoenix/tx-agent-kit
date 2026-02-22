'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { clearAuthToken, readAuthToken } from '../../lib/auth-token'
import { ApiClientError, clientApi } from '../../lib/client-api'
import { sessionStoreActions } from '../../stores/session-store'

export function AuthBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let active = true

    const bootstrap = async () => {
      const token = readAuthToken()

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
      } catch (error) {
        if (!active) {
          return
        }

        if (error instanceof ApiClientError && error.status === 401) {
          clearAuthToken()
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
