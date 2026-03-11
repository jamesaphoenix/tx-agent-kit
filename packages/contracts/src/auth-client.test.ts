import { describe, expect, it, vi } from 'vitest'
import {
  buildSignInPath,
  createSessionRestorer,
  isAuthStatus,
  isAuthStatusError,
  restoreAuthenticatedPrincipal,
  usesBrowserAuthSessionMode
} from './auth-client.js'

describe('auth client helpers', () => {
  it('builds sign-in redirects with encoded next paths', () => {
    expect(buildSignInPath('/organizations?tab=active')).toBe(
      '/sign-in?next=%2Forganizations%3Ftab%3Dactive'
    )
  })

  it('classifies auth statuses and status-bearing errors', () => {
    expect(isAuthStatus(401)).toBe(true)
    expect(isAuthStatus(403)).toBe(true)
    expect(isAuthStatus(400)).toBe(false)
    expect(isAuthStatusError({ status: 401 })).toBe(true)
    expect(isAuthStatusError({ status: 403 })).toBe(true)
    expect(isAuthStatusError({ status: 500 })).toBe(false)
    expect(isAuthStatusError(new Error('no status'))).toBe(false)
  })

  it('shares one in-flight restore across callers', async () => {
    let hasAccessToken = false
    const refreshSession = vi.fn(async () => {
      await Promise.resolve()
      hasAccessToken = true
    })
    const serializeRefreshCalls = vi.fn()
    const serializeRefresh = async <T>(callback: () => Promise<T>): Promise<T> => {
      serializeRefreshCalls()
      return callback()
    }
    const restoreSession = createSessionRestorer({
      hasAccessToken: async () => {
        await Promise.resolve()
        return hasAccessToken
      },
      canRefreshSession: async () => {
        await Promise.resolve()
        return true
      },
      refreshSession,
      serializeRefresh
    })

    const first = restoreSession()
    const second = restoreSession()

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(serializeRefreshCalls).toHaveBeenCalledTimes(1)
  })

  it('returns false for unauthorized refresh failures', async () => {
    const unauthorizedError = Object.assign(new Error('Unauthorized'), { status: 401 })
    const restoreSession = createSessionRestorer({
      hasAccessToken: async () => {
        await Promise.resolve()
        return false
      },
      canRefreshSession: async () => {
        await Promise.resolve()
        return true
      },
      refreshSession: async () => {
        await Promise.resolve()
        throw unauthorizedError
      }
    })

    await expect(restoreSession()).resolves.toBe(false)
  })

  it('restores authenticated principals and clears credentials on auth errors', async () => {
    const forbiddenError = Object.assign(new Error('Forbidden'), { status: 403 })
    const clearCredentials = vi.fn(async () => {
      await Promise.resolve()
    })

    await expect(
      restoreAuthenticatedPrincipal({
        restoreSession: async () => {
          await Promise.resolve()
          return true
        },
        loadPrincipal: async () => {
          await Promise.resolve()
          return { email: 'member@example.com' }
        },
        clearCredentialsOnAuthError: clearCredentials
      })
    ).resolves.toEqual({ email: 'member@example.com' })

    await expect(
      restoreAuthenticatedPrincipal({
        restoreSession: async () => {
          await Promise.resolve()
          return true
        },
        loadPrincipal: async () => {
          await Promise.resolve()
          throw forbiddenError
        },
        clearCredentialsOnAuthError: clearCredentials
      })
    ).resolves.toBeNull()

    expect(clearCredentials).toHaveBeenCalledTimes(1)
  })

  it('uses browser auth session mode only for managed routes', () => {
    expect(
      usesBrowserAuthSessionMode({ method: 'post', url: '/v1/auth/sign-in' })
    ).toBe(true)
    expect(
      usesBrowserAuthSessionMode({ method: 'post', url: '/v1/auth/forgot-password' })
    ).toBe(false)
  })
})
