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

  getPermissions: () => {
    const principal = sessionStore.state.principal

    if (!principal) {
      return Promise.resolve(['authenticated'])
    }

    // Returns the user's org-level roles so react-admin consumers can gate UI elements.
    // This does NOT replace server-side authorization — the API must scope responses
    // to the caller's own organizations. A system-level admin concept is needed to
    // properly restrict the admin panel to platform administrators.
    return Promise.resolve(['authenticated', ...principal.roles])
  }
}
