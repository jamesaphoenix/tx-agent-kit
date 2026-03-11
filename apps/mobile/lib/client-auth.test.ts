import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAuthToken, writeAuthToken } from './auth-token'
import { ApiClientError, clientApi } from './client-api'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from './client-auth'
import { sessionStoreActions } from '../stores/session-store'

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

vi.mock('../stores/session-store', () => ({
  sessionStoreActions: {
    setPrincipal: vi.fn(),
    clear: vi.fn()
  }
}))

vi.mock('./client-api', () => {
  class MockApiClientError extends Error {
    readonly status: number | undefined

    constructor(message: string, status?: number) {
      super(message)
      Object.setPrototypeOf(this, new.target.prototype)
      this.name = 'ApiClientError'
      this.status = status
    }
  }

  return {
    ApiClientError: MockApiClientError,
    clientApi: {
      restoreSession: vi.fn()
    }
  }
})

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: { API_BASE_URL: 'https://test.example.com' }
    }
  }
}))

const createMockRouter = () => ({
  replace: vi.fn()
})

describe('ensureSessionOrRedirect', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key]
    }
    vi.mocked(clientApi.restoreSession).mockReset()
  })

  it('returns true when a token exists', async () => {
    await writeAuthToken('valid-jwt')
    const router = createMockRouter()

    const result = await ensureSessionOrRedirect(router, '/dashboard')

    expect(result).toBe(true)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('restores the session from a stored refresh token when access token is missing', async () => {
    vi.mocked(clientApi.restoreSession).mockResolvedValue(true)
    const router = createMockRouter()

    const result = await ensureSessionOrRedirect(router, '/dashboard')

    expect(result).toBe(true)
    expect(clientApi.restoreSession).toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('redirects to sign-in when no token', async () => {
    vi.mocked(clientApi.restoreSession).mockResolvedValue(false)
    const router = createMockRouter()

    const result = await ensureSessionOrRedirect(router, '/dashboard')

    expect(result).toBe(false)
    expect(router.replace).toHaveBeenCalledWith('/sign-in?next=%2Fdashboard')
  })

  it('encodes the next path parameter', async () => {
    vi.mocked(clientApi.restoreSession).mockResolvedValue(false)
    const router = createMockRouter()

    await ensureSessionOrRedirect(router, '/organizations?tab=active')

    expect(router.replace).toHaveBeenCalledWith(
      '/sign-in?next=%2Forganizations%3Ftab%3Dactive'
    )
  })
})

describe('handleUnauthorizedApiError', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key]
    }
  })

  it('handles 401 ApiClientError by clearing token, session, and redirecting', async () => {
    await writeAuthToken('expired-jwt')
    const router = createMockRouter()
    const error = new ApiClientError('Unauthorized', 401)

    const result = await handleUnauthorizedApiError(error, router, '/dashboard')

    expect(result).toBe(true)
    expect(await readAuthToken()).toBeNull()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/sign-in?next=%2Fdashboard')
  })

  it('handles 403 ApiClientError by clearing token, session, and redirecting', async () => {
    await writeAuthToken('forbidden-jwt')
    const router = createMockRouter()
    const error = new ApiClientError('Forbidden', 403)

    const result = await handleUnauthorizedApiError(error, router, '/dashboard')

    expect(result).toBe(true)
    expect(await readAuthToken()).toBeNull()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/sign-in?next=%2Fdashboard')
  })

  it('returns false for non-auth ApiClientError (e.g. 404)', async () => {
    const router = createMockRouter()
    const error = new ApiClientError('Not Found', 404)

    const result = await handleUnauthorizedApiError(error, router, '/dashboard')

    expect(result).toBe(false)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('returns false for non-ApiClientError', async () => {
    const router = createMockRouter()
    const error = new Error('Network error')

    const result = await handleUnauthorizedApiError(error, router, '/dashboard')

    expect(result).toBe(false)
    expect(router.replace).not.toHaveBeenCalled()
  })
})
