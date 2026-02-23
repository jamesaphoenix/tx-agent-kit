'use client'

import type { AuthProvider } from 'react-admin'
import { clearAuthToken, readAuthToken } from '../auth-token'
import { clientApi } from '../client-api'

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
    if (status === 401 || status === 403) {
      clearAuthToken()
      return Promise.reject(new Error('Session expired'))
    }

    return Promise.resolve()
  },

  checkAuth: () => {
    const token = readAuthToken()
    if (!token) {
      return Promise.reject(new Error('Authentication required'))
    }

    return Promise.resolve()
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
