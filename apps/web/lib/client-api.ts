import type {
  AuthPrincipal,
  AuthResponse,
  Invitation,
  SignInRequest,
  SignUpRequest,
  Task,
  Workspace
} from '@tx-agent-kit/contracts'
import { clearAuthToken, writeAuthToken } from './auth-token'
import { api, getApiErrorMessage, getApiErrorStatus } from './axios'

export class ApiClientError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
  }
}

const fail = (error: unknown, fallback: string): never => {
  throw new ApiClientError(getApiErrorMessage(error, fallback), getApiErrorStatus(error))
}

const persistAuthSession = (response: AuthResponse): void => {
  writeAuthToken(response.token)
}

export const clientApi = {
  signIn: async (input: SignInRequest): Promise<void> => {
    try {
      const { data } = await api.post<AuthResponse>('/v1/auth/sign-in', input)
      persistAuthSession(data)
    } catch (error) {
      return fail(error, 'Authentication failed')
    }
  },

  signUp: async (input: SignUpRequest): Promise<void> => {
    try {
      const { data } = await api.post<AuthResponse>('/v1/auth/sign-up', input)
      persistAuthSession(data)
    } catch (error) {
      return fail(error, 'Sign-up failed')
    }
  },

  signOut: (): Promise<void> => {
    clearAuthToken()
    return Promise.resolve()
  },

  me: async (): Promise<AuthPrincipal> => {
    try {
      const { data } = await api.get<AuthPrincipal>('/v1/auth/me')
      return data
    } catch (error) {
      return fail(error, 'Failed to fetch current user')
    }
  },

  listWorkspaces: async (): Promise<{ workspaces: Workspace[] }> => {
    try {
      const { data } = await api.get<{ workspaces: Workspace[] }>('/v1/workspaces')
      return data
    } catch (error) {
      return fail(error, 'Failed to list workspaces')
    }
  },

  createWorkspace: async (input: { name: string }): Promise<Workspace> => {
    try {
      const { data } = await api.post<Workspace>('/v1/workspaces', input)
      return data
    } catch (error) {
      return fail(error, 'Failed to create workspace')
    }
  },

  listTasks: async (workspaceId: string): Promise<{ tasks: Task[] }> => {
    try {
      const { data } = await api.get<{ tasks: Task[] }>('/v1/tasks', {
        params: { workspaceId }
      })
      return data
    } catch (error) {
      return fail(error, 'Failed to list tasks')
    }
  },

  createTask: async (input: {
    workspaceId: string
    title: string
    description?: string
  }): Promise<Task> => {
    try {
      const { data } = await api.post<Task>('/v1/tasks', input)
      return data
    } catch (error) {
      return fail(error, 'Failed to create task')
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
    workspaceId: string
    email: string
    role: 'admin' | 'member'
  }): Promise<Invitation> => {
    try {
      const { data } = await api.post<Invitation>('/v1/invitations', input)
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
