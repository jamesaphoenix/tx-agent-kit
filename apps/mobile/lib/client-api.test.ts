import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { readAuthToken } from './auth-token'
import { api } from './axios'
import { ApiClientError, clientApi } from './client-api'

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: { API_BASE_URL: 'https://test.example.com' }
    }
  }
}))

const mockStore: Record<string, string> = {}

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(mockStore[key] ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    mockStore[key] = value
    return Promise.resolve()
  }),
  deleteItemAsync: vi.fn((key: string) => {
    delete mockStore[key]
    return Promise.resolve()
  })
}))

let mockAdapter: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>

beforeEach(() => {
  for (const key of Object.keys(mockStore)) {
    delete mockStore[key]
  }
  mockAdapter = () => Promise.reject(new Error('No mock configured'))
  api.defaults.adapter = (config: InternalAxiosRequestConfig) => mockAdapter(config)
})

const respondWith = (status: number, data: unknown) => {
  mockAdapter = (config: InternalAxiosRequestConfig) =>
    Promise.resolve({ data, status, statusText: 'OK', headers: {}, config } as AxiosResponse)
}

const respondWithError = (status: number, data: unknown) => {
  mockAdapter = (config: InternalAxiosRequestConfig) => {
    const error = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status, data, statusText: 'Error', headers: {}, config },
      config,
      toJSON: () => ({})
    })
    return Promise.reject(error)
  }
}

describe('clientApi.signIn', () => {
  it('persists auth token from response', async () => {
    respondWith(200, { token: 'jwt-sign-in-token' })

    await clientApi.signIn({ email: 'test@example.com', password: 'password123' })

    const token = await readAuthToken()
    expect(token).toBe('jwt-sign-in-token')
  })

  it('throws ApiClientError on failure', async () => {
    respondWithError(401, { error: { message: 'Invalid credentials' } })

    await expect(
      clientApi.signIn({ email: 'test@example.com', password: 'wrong' })
    ).rejects.toThrow(ApiClientError)
  })
})

describe('clientApi.signUp', () => {
  it('persists auth token from response', async () => {
    respondWith(200, { token: 'jwt-sign-up-token' })

    await clientApi.signUp({ email: 'test@example.com', password: 'password123', name: 'Test' })

    const token = await readAuthToken()
    expect(token).toBe('jwt-sign-up-token')
  })

  it('throws ApiClientError on failure', async () => {
    respondWithError(409, { error: { message: 'Email already exists' } })

    await expect(
      clientApi.signUp({ email: 'dup@example.com', password: 'password123', name: 'Dup' })
    ).rejects.toThrow(ApiClientError)
  })
})

describe('clientApi.signOut', () => {
  it('clears the stored auth token', async () => {
    mockStore['tx-agent-kit.auth-token'] = 'existing-token'

    await clientApi.signOut()

    const token = await readAuthToken()
    expect(token).toBeNull()
  })
})

describe('clientApi.me', () => {
  it('returns the current user principal', async () => {
    const principal = {
      userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      email: 'test@example.com',
      roles: ['member']
    }
    respondWith(200, principal)

    const result = await clientApi.me()
    expect(result).toEqual(principal)
  })

  it('throws ApiClientError on 401 with correct status', async () => {
    respondWithError(401, { error: { message: 'Unauthorized' } })

    const rejection = expect(clientApi.me()).rejects
    await rejection.toThrow(ApiClientError)

    respondWithError(401, { error: { message: 'Unauthorized' } })
    await expect(clientApi.me()).rejects.toMatchObject({
      status: 401,
      name: 'ApiClientError'
    })
  })
})

describe('clientApi.listWorkspaces', () => {
  it('returns workspaces list', async () => {
    const response = { workspaces: [{ id: 'ws-1', name: 'Test Workspace' }] }
    respondWith(200, response)

    const result = await clientApi.listWorkspaces()
    expect(result.workspaces).toHaveLength(1)
  })

  it('throws ApiClientError on failure', async () => {
    respondWithError(500, { error: { message: 'Server error' } })

    await expect(clientApi.listWorkspaces()).rejects.toThrow(ApiClientError)
  })
})

describe('clientApi.createWorkspace', () => {
  it('returns created workspace', async () => {
    const workspace = { id: 'ws-1', name: 'New Workspace' }
    respondWith(201, workspace)

    const result = await clientApi.createWorkspace({ name: 'New Workspace' })
    expect(result.name).toBe('New Workspace')
  })

  it('throws ApiClientError on failure', async () => {
    respondWithError(400, { error: { message: 'Name too short' } })

    await expect(
      clientApi.createWorkspace({ name: '' })
    ).rejects.toThrow(ApiClientError)
  })
})

describe('clientApi.listTasks', () => {
  it('returns tasks list for a workspace', async () => {
    const response = { tasks: [{ id: 't-1', title: 'Task 1', workspaceId: 'ws-1', status: 'pending' }] }
    respondWith(200, response)

    const result = await clientApi.listTasks('ws-1')
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].title).toBe('Task 1')
  })

  it('throws ApiClientError on failure', async () => {
    respondWithError(500, { error: { message: 'Server error' } })

    await expect(clientApi.listTasks('ws-1')).rejects.toThrow(ApiClientError)
  })
})

describe('clientApi.createTask', () => {
  it('returns created task', async () => {
    const task = { id: 't-1', title: 'New Task', workspaceId: 'ws-1', status: 'pending' }
    respondWith(201, task)

    const result = await clientApi.createTask({ workspaceId: 'ws-1', title: 'New Task' })
    expect(result.title).toBe('New Task')
  })

  it('throws ApiClientError on failure', async () => {
    respondWithError(400, { error: { message: 'Title required' } })

    await expect(
      clientApi.createTask({ workspaceId: 'ws-1', title: '' })
    ).rejects.toThrow(ApiClientError)
  })
})

describe('clientApi.listInvitations', () => {
  it('returns invitations list', async () => {
    const response = { invitations: [{ id: 'inv-1', email: 'peer@co.com', role: 'member', status: 'pending' }] }
    respondWith(200, response)

    const result = await clientApi.listInvitations()
    expect(result.invitations).toHaveLength(1)
  })

  it('throws ApiClientError on failure', async () => {
    respondWithError(500, { error: { message: 'Server error' } })

    await expect(clientApi.listInvitations()).rejects.toThrow(ApiClientError)
  })
})

describe('clientApi.createInvitation', () => {
  it('returns created invitation', async () => {
    const invitation = { id: 'inv-1', email: 'peer@co.com', role: 'member', workspaceId: 'ws-1', status: 'pending' }
    respondWith(201, invitation)

    const result = await clientApi.createInvitation({ workspaceId: 'ws-1', email: 'peer@co.com', role: 'member' })
    expect(result.email).toBe('peer@co.com')
  })

  it('throws ApiClientError on failure', async () => {
    respondWithError(409, { error: { message: 'Already invited' } })

    await expect(
      clientApi.createInvitation({ workspaceId: 'ws-1', email: 'peer@co.com', role: 'member' })
    ).rejects.toThrow(ApiClientError)
  })
})

describe('clientApi.acceptInvitation', () => {
  it('encodes token in URL', async () => {
    let capturedUrl = ''
    mockAdapter = (config: InternalAxiosRequestConfig) => {
      capturedUrl = config.url ?? ''
      return Promise.resolve({
        data: { accepted: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config
      } as AxiosResponse)
    }

    await clientApi.acceptInvitation('my-token/special')
    expect(capturedUrl).toBe('/v1/invitations/my-token%2Fspecial/accept')
  })

  it('throws ApiClientError on failure', async () => {
    respondWithError(404, { error: { message: 'Invitation not found' } })

    await expect(
      clientApi.acceptInvitation('bad-token')
    ).rejects.toThrow(ApiClientError)
  })
})

describe('ApiClientError', () => {
  it('has correct name and status', () => {
    const error = new ApiClientError('Not found', 404)
    expect(error.name).toBe('ApiClientError')
    expect(error.message).toBe('Not found')
    expect(error.status).toBe(404)
    expect(error).toBeInstanceOf(Error)
  })

  it('supports undefined status', () => {
    const error = new ApiClientError('Network error')
    expect(error.status).toBeUndefined()
  })
})
