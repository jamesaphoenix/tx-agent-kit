// @vitest-environment jsdom
import { clearAuthToken, readAuthToken, writeAuthToken } from './auth-token'
import { ApiClientError } from './client-api'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from './client-auth'
import {
  sessionStore,
  sessionStoreActions,
  sessionStoreInitialState
} from '../stores/session-store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('client-auth guards', () => {
  beforeEach(() => {
    clearAuthToken()
    sessionStore.setState(() => sessionStoreInitialState)
    vi.restoreAllMocks()
  })

  it('returns true when the session store already has a principal', () => {
    const router = { replace: vi.fn<(path: string) => void>() }
    sessionStoreActions.setPrincipal({
      userId: 'user-1',
      email: 'member@example.com',
      roles: ['member'],
      permissions: []
    })

    const hasSession = ensureSessionOrRedirect(router, '/dashboard')

    expect(hasSession).toBe(true)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('waits for bootstrap when the session store is not ready yet', () => {
    const router = { replace: vi.fn<(path: string) => void>() }

    const hasSession = ensureSessionOrRedirect(router, '/organizations')

    expect(hasSession).toBe(false)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('redirects to sign-in when bootstrap finished without a session', () => {
    const router = { replace: vi.fn<(path: string) => void>() }
    sessionStoreActions.clear()

    const hasSession = ensureSessionOrRedirect(router, '/organizations')

    expect(hasSession).toBe(false)
    expect(router.replace).toHaveBeenCalledWith('/sign-in?next=%2Forganizations')
  })

  it('preserves the full next path when redirecting to sign-in', () => {
    const router = { replace: vi.fn<(path: string) => void>() }
    sessionStoreActions.clear()

    const hasSession = ensureSessionOrRedirect(router, '/org/abc/workspaces?tab=active')

    expect(hasSession).toBe(false)
    expect(router.replace).toHaveBeenCalledWith(
      '/sign-in?next=%2Forg%2Fabc%2Fworkspaces%3Ftab%3Dactive'
    )
  })

  it('clears auth token, session store, and redirects on 401', () => {
    writeAuthToken('stale-auth-token')
    const router = { replace: vi.fn<(path: string) => void>() }
    const clearSpy = vi.spyOn(sessionStoreActions, 'clear')

    const redirected = handleUnauthorizedApiError(
      new ApiClientError('unauthorized', 401),
      router,
      '/dashboard'
    )

    expect(redirected).toBe(true)
    expect(readAuthToken()).toBeNull()
    expect(clearSpy).toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/sign-in?next=%2Fdashboard')
  })

  it('does not clear auth token or redirect on 403 (user is authenticated but lacks permission)', () => {
    writeAuthToken('forbidden-token')
    const router = { replace: vi.fn<(path: string) => void>() }
    const clearSpy = vi.spyOn(sessionStoreActions, 'clear')

    const redirected = handleUnauthorizedApiError(
      new ApiClientError('forbidden', 403),
      router,
      '/dashboard'
    )

    expect(redirected).toBe(false)
    expect(readAuthToken()).toBe('forbidden-token')
    expect(clearSpy).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('ignores non-auth errors and does not clear session', () => {
    writeAuthToken('active-token')
    const router = { replace: vi.fn<(path: string) => void>() }
    const clearSpy = vi.spyOn(sessionStoreActions, 'clear')

    const redirected = handleUnauthorizedApiError(
      new ApiClientError('bad-request', 400),
      router,
      '/dashboard'
    )

    expect(redirected).toBe(false)
    expect(readAuthToken()).toBe('active-token')
    expect(clearSpy).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })
})
