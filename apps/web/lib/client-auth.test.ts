// @vitest-environment jsdom
import { clearAuthToken, readAuthToken, writeAuthToken } from './auth-token'
import { ApiClientError } from './client-api'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from './client-auth'
import { sessionStoreActions } from '../stores/session-store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../stores/session-store', () => ({
  sessionStoreActions: {
    setPrincipal: vi.fn(),
    clear: vi.fn(),
    setReady: vi.fn()
  }
}))

describe('client-auth guards', () => {
  beforeEach(() => {
    clearAuthToken()
    vi.clearAllMocks()
  })

  it('returns true when a token exists', () => {
    writeAuthToken('existing-auth-token')
    const router = { replace: vi.fn<(path: string) => void>() }

    const hasSession = ensureSessionOrRedirect(router, '/dashboard')

    expect(hasSession).toBe(true)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('redirects to sign-in when token is missing', () => {
    const router = { replace: vi.fn<(path: string) => void>() }

    const hasSession = ensureSessionOrRedirect(router, '/workspaces')

    expect(hasSession).toBe(false)
    expect(router.replace).toHaveBeenCalledWith('/sign-in?next=%2Fworkspaces')
  })

  it('clears auth token, session store, and redirects on 401', () => {
    writeAuthToken('stale-auth-token')
    const router = { replace: vi.fn<(path: string) => void>() }

    const redirected = handleUnauthorizedApiError(
      new ApiClientError('unauthorized', 401),
      router,
      '/dashboard'
    )

    expect(redirected).toBe(true)
    expect(readAuthToken()).toBeNull()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/sign-in?next=%2Fdashboard')
  })

  it('clears auth token, session store, and redirects on 403', () => {
    writeAuthToken('forbidden-token')
    const router = { replace: vi.fn<(path: string) => void>() }

    const redirected = handleUnauthorizedApiError(
      new ApiClientError('forbidden', 403),
      router,
      '/dashboard'
    )

    expect(redirected).toBe(true)
    expect(readAuthToken()).toBeNull()
    expect(sessionStoreActions.clear).toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/sign-in?next=%2Fdashboard')
  })

  it('ignores non-auth errors and does not clear session', () => {
    writeAuthToken('active-token')
    const router = { replace: vi.fn<(path: string) => void>() }

    const redirected = handleUnauthorizedApiError(
      new ApiClientError('bad-request', 400),
      router,
      '/dashboard'
    )

    expect(redirected).toBe(false)
    expect(readAuthToken()).toBe('active-token')
    expect(sessionStoreActions.clear).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })
})
