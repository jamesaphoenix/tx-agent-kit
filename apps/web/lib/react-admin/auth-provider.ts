'use client'

import { restoreAuthenticatedPrincipal } from '@tx-agent-kit/contracts'
import type { AuthProvider } from 'react-admin'
import { clearAuthToken } from '../auth-token'
import { clientApi } from '../client-api'
import { sessionStore, sessionStoreActions } from '../../stores/session-store'

export const authProvider: AuthProvider = {
  login: async ({ username, password }) => {
    await clientApi.signIn({
      email: String(username),
      password: String(password)
    })
  },

  logout: async () => {
    await clientApi.signOut()
  },

  checkError: ({ status }) => {
    if (status === 401) {
      clearAuthToken()
      sessionStoreActions.clear()
      return Promise.reject(new Error('Session expired'))
    }

    return Promise.resolve()
  },

  checkAuth: async () => {
    if (sessionStore.state.principal) {
      return
    }

    const principal = await restoreAuthenticatedPrincipal({
      restoreSession: clientApi.restoreSession,
      loadPrincipal: clientApi.me,
      clearCredentialsOnAuthError: () => {
        clearAuthToken()
      }
    })

    if (principal === null) {
      sessionStoreActions.clear()
      throw new Error('Authentication required')
    }

    sessionStoreActions.setPrincipal(principal)
  },

  getIdentity: async () => {
    const principal = await clientApi.me()

    return {
      id: principal.userId,
      fullName: principal.email,
      email: principal.email
    }
  },

  getPermissions: () => Promise.resolve<string[]>([])
}
