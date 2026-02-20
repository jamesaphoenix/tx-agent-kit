import type { AuthResponse, Invitation, Task, Workspace } from '@tx-agent-kit/contracts'
import { api, clearSessionToken, getApiErrorMessage, setSessionToken } from './axios'

const fail = (error: unknown, fallback: string): never => {
  throw new Error(getApiErrorMessage(error, fallback))
}

export const clientApi = {
  signIn: async (input: { email: string; password: string }): Promise<AuthResponse> => {
    try {
      const { data } = await api.post<AuthResponse>('/v1/auth/sign-in', input)
      setSessionToken(data.token)
      return data
    } catch (error) {
      return fail(error, 'Authentication failed')
    }
  },

  signUp: async (input: { email: string; password: string; name: string }): Promise<AuthResponse> => {
    try {
      const { data } = await api.post<AuthResponse>('/v1/auth/sign-up', input)
      setSessionToken(data.token)
      return data
    } catch (error) {
      return fail(error, 'Sign-up failed')
    }
  },

  signOut: (): void => {
    clearSessionToken()
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

  createTask: async (input: { workspaceId: string; title: string; description?: string }): Promise<Task> => {
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

  createInvitation: async (input: { workspaceId: string; email: string; role: 'admin' | 'member' }): Promise<Invitation> => {
    try {
      const { data } = await api.post<Invitation>('/v1/invitations', input)
      return data
    } catch (error) {
      return fail(error, 'Failed to send invitation')
    }
  },

  acceptInvitation: async (token: string): Promise<{ accepted: boolean }> => {
    try {
      const { data } = await api.post<{ accepted: boolean }>(`/v1/invitations/${encodeURIComponent(token)}/accept`)
      return data
    } catch (error) {
      return fail(error, 'Failed to accept invitation')
    }
  }
}
