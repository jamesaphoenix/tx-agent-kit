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
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'ApiClientError'
    this.status = status
  }
}

export interface ListQuery {
  cursor?: string
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  filter?: Record<string, string>
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  nextCursor: string | null
  prevCursor: string | null
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isPaginatedResponse = <T>(value: unknown): value is PaginatedResponse<T> => {
  if (!isObjectRecord(value)) {
    return false
  }

  return (
    Array.isArray(value.data) &&
    typeof value.total === 'number' &&
    (typeof value.nextCursor === 'string' || value.nextCursor === null) &&
    (typeof value.prevCursor === 'string' || value.prevCursor === null)
  )
}

const normalizePaginatedResponse = <T>(
  value: unknown,
  legacyArrayKey: string
): PaginatedResponse<T> => {
  if (isPaginatedResponse<T>(value)) {
    return value
  }

  if (isObjectRecord(value)) {
    const legacy = value[legacyArrayKey]
    if (Array.isArray(legacy)) {
      return {
        data: legacy as T[],
        total: legacy.length,
        nextCursor: null,
        prevCursor: null
      }
    }
  }

  throw new ApiClientError('Unexpected list response shape')
}

const fail = (error: unknown, fallback: string): never => {
  throw new ApiClientError(getApiErrorMessage(error, fallback), getApiErrorStatus(error))
}

const persistAuthSession = (response: AuthResponse): void => {
  writeAuthToken(response.token)
}

const toListParams = (query: ListQuery | undefined): Record<string, string> => {
  const params: Record<string, string> = {}
  if (!query) {
    return params
  }

  if (query.cursor) {
    params.cursor = query.cursor
  }

  if (query.limit !== undefined) {
    params.limit = String(query.limit)
  }

  if (query.sortBy) {
    params.sortBy = query.sortBy
  }

  if (query.sortOrder) {
    params.sortOrder = query.sortOrder
  }

  if (query.filter) {
    for (const [key, value] of Object.entries(query.filter)) {
      if (value !== '') {
        params[`filter[${key}]`] = value
      }
    }
  }

  return params
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

  listWorkspaces: async (query?: ListQuery): Promise<PaginatedResponse<Workspace>> => {
    try {
      const { data } = await api.get<unknown>('/v1/workspaces', {
        params: toListParams(query)
      })
      return normalizePaginatedResponse<Workspace>(data, 'workspaces')
    } catch (error) {
      return fail(error, 'Failed to list workspaces')
    }
  },

  getWorkspace: async (id: string): Promise<Workspace> => {
    try {
      const { data } = await api.get<Workspace>(`/v1/workspaces/${encodeURIComponent(id)}`)
      return data
    } catch (error) {
      return fail(error, 'Failed to fetch workspace')
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

  updateWorkspace: async (id: string, input: { name?: string }): Promise<Workspace> => {
    try {
      const { data } = await api.patch<Workspace>(`/v1/workspaces/${encodeURIComponent(id)}`, input)
      return data
    } catch (error) {
      return fail(error, 'Failed to update workspace')
    }
  },

  removeWorkspace: async (id: string): Promise<{ deleted: true }> => {
    try {
      const { data } = await api.delete<{ deleted: true }>(`/v1/workspaces/${encodeURIComponent(id)}`)
      return data
    } catch (error) {
      return fail(error, 'Failed to delete workspace')
    }
  },

  listTasks: async (workspaceId: string, query?: ListQuery): Promise<PaginatedResponse<Task>> => {
    try {
      const { data } = await api.get<unknown>('/v1/tasks', {
        params: {
          workspaceId,
          ...toListParams(query)
        }
      })
      return normalizePaginatedResponse<Task>(data, 'tasks')
    } catch (error) {
      return fail(error, 'Failed to list tasks')
    }
  },

  getTask: async (id: string): Promise<Task> => {
    try {
      const { data } = await api.get<Task>(`/v1/tasks/${encodeURIComponent(id)}`)
      return data
    } catch (error) {
      return fail(error, 'Failed to fetch task')
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

  updateTask: async (id: string, input: {
    title?: string
    description?: string | null
    status?: 'todo' | 'in_progress' | 'done'
  }): Promise<Task> => {
    try {
      const { data } = await api.patch<Task>(`/v1/tasks/${encodeURIComponent(id)}`, input)
      return data
    } catch (error) {
      return fail(error, 'Failed to update task')
    }
  },

  removeTask: async (id: string): Promise<{ deleted: true }> => {
    try {
      const { data } = await api.delete<{ deleted: true }>(`/v1/tasks/${encodeURIComponent(id)}`)
      return data
    } catch (error) {
      return fail(error, 'Failed to delete task')
    }
  },

  listInvitations: async (query?: ListQuery): Promise<PaginatedResponse<Invitation>> => {
    try {
      const { data } = await api.get<unknown>('/v1/invitations', {
        params: toListParams(query)
      })
      return normalizePaginatedResponse<Invitation>(data, 'invitations')
    } catch (error) {
      return fail(error, 'Failed to list invitations')
    }
  },

  getInvitation: async (id: string): Promise<Invitation> => {
    try {
      const { data } = await api.get<Invitation>(`/v1/invitations/${encodeURIComponent(id)}`)
      return data
    } catch (error) {
      return fail(error, 'Failed to fetch invitation')
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

  updateInvitation: async (id: string, input: {
    role?: 'admin' | 'member'
    status?: 'pending' | 'accepted' | 'revoked' | 'expired'
  }): Promise<Invitation> => {
    try {
      const { data } = await api.patch<Invitation>(`/v1/invitations/${encodeURIComponent(id)}`, input)
      return data
    } catch (error) {
      return fail(error, 'Failed to update invitation')
    }
  },

  removeInvitation: async (id: string): Promise<{ deleted: true }> => {
    try {
      const { data } = await api.delete<{ deleted: true }>(`/v1/invitations/${encodeURIComponent(id)}`)
      return data
    } catch (error) {
      return fail(error, 'Failed to revoke invitation')
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
