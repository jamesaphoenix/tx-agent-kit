import type {
  AuthPrincipal,
  AuthResponse,
  Invitation,
  Organization,
  SignInRequest,
  SignUpRequest
} from '@tx-agent-kit/contracts'
import {
  clearAuthToken,
  clearRefreshToken,
  readAuthToken,
  readRefreshToken,
  writeAuthToken,
  writeRefreshToken
} from './auth-token'
import { api, getApiErrorMessage, getApiErrorStatus } from './axios'

export class ApiClientError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'ApiClientError'
    this.status = status
  }
}

const fail = (error: unknown, fallback: string): never => {
  throw new ApiClientError(getApiErrorMessage(error, fallback), getApiErrorStatus(error))
}

const persistAuthSession = async (response: AuthResponse): Promise<void> => {
  await writeAuthToken(response.token)
  await writeRefreshToken(response.refreshToken)
}

export const clientApi = {
  signIn: async (input: SignInRequest): Promise<void> => {
    try {
      const { data } = await api.post<AuthResponse>('/v1/auth/sign-in', input)
      await persistAuthSession(data)
    } catch (error) {
      return fail(error, 'Authentication failed')
    }
  },

  signUp: async (input: SignUpRequest): Promise<void> => {
    try {
      const { data } = await api.post<AuthResponse>('/v1/auth/sign-up', input)
      await persistAuthSession(data)
    } catch (error) {
      return fail(error, 'Sign-up failed')
    }
  },

  signOut: async (): Promise<void> => {
    const token = await readAuthToken()
    await clearAuthToken()
    await clearRefreshToken()

    if (!token) {
      return
    }

    try {
      await api.post('/v1/auth/sign-out', undefined, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
    } catch (error) {
      void error
    }
  },

  refreshSession: async (): Promise<void> => {
    const refreshToken = await readRefreshToken()
    if (!refreshToken) {
      throw new ApiClientError('No refresh token is available')
    }

    try {
      const { data } = await api.post<AuthResponse>('/v1/auth/refresh', {
        refreshToken
      })
      await persistAuthSession(data)
    } catch (error) {
      return fail(error, 'Failed to refresh session')
    }
  },

  me: async (): Promise<AuthPrincipal> => {
    try {
      const { data } = await api.get<AuthPrincipal>('/v1/auth/me')
      return data
    } catch (error) {
      return fail(error, 'Failed to fetch current user')
    }
  },

  listOrganizations: async (): Promise<{ organizations: Organization[] }> => {
    try {
      const { data } = await api.get<{ organizations: Organization[] }>('/v1/organizations')
      return { organizations: data.organizations }
    } catch (error) {
      return fail(error, 'Failed to list organizations')
    }
  },

  createOrganization: async (input: { name: string }): Promise<Organization> => {
    try {
      const { data } = await api.post<Organization>('/v1/organizations', input)
      return data
    } catch (error) {
      return fail(error, 'Failed to create organization')
    }
  },

  listInvitations: async (): Promise<{ invitations: Invitation[] }> => {
    try {
      const { data } = await api.get<{ invitations: Invitation[] }>('/v1/invitations')
      return data
    } catch (error) {
      return fail(error, 'Failed to list invitations')
    }
  },

  createInvitation: async (input: {
    organizationId: string
    email: string
    role: 'admin' | 'member'
  }): Promise<Invitation> => {
    try {
      const { data } = await api.post<Invitation>('/v1/invitations', {
        organizationId: input.organizationId,
        email: input.email,
        role: input.role
      })
      return data
    } catch (error) {
      return fail(error, 'Failed to send invitation')
    }
  },

  acceptInvitation: async (token: string): Promise<{ accepted: boolean }> => {
    try {
      const { data } = await api.post<{ accepted: boolean }>(
        `/v1/invitations/${encodeURIComponent(token)}/accept`
      )
      return data
    } catch (error) {
      return fail(error, 'Failed to accept invitation')
    }
  }
}
