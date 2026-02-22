import { clearAuthToken, readAuthToken, writeAuthToken } from './auth-token'
import { ApiClientError } from './client-api'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from './client-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('client-auth guards', () => {
  beforeEach(() => {
    clearAuthToken()
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

  it('clears auth token and redirects on unauthorized API errors', () => {
    writeAuthToken('stale-auth-token')
    const router = { replace: vi.fn<(path: string) => void>() }

    const redirected = handleUnauthorizedApiError(
      new ApiClientError('unauthorized', 401),
      router,
      '/dashboard'
    )

    expect(redirected).toBe(true)
    expect(readAuthToken()).toBeNull()
    expect(router.replace).toHaveBeenCalledWith('/sign-in?next=%2Fdashboard')
  })

  it('ignores non-401 errors', () => {
    writeAuthToken('active-token')
    const router = { replace: vi.fn<(path: string) => void>() }

    const redirected = handleUnauthorizedApiError(
      new ApiClientError('bad-request', 400),
      router,
      '/dashboard'
    )

    expect(redirected).toBe(false)
    expect(readAuthToken()).toBe('active-token')
    expect(router.replace).not.toHaveBeenCalled()
  })
})
