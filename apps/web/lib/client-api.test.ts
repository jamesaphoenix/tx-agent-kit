import type { AuthResponse } from '@tx-agent-kit/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAuthToken, readAuthToken, writeAuthToken } from './auth-token'
import { ApiClientError, clientApi, restoreCurrentPrincipal } from './client-api'

const restoredPrincipal = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'restored@example.com',
  organizationId: '22222222-2222-4222-8222-222222222222',
  roles: ['admin' as const],
  permissions: ['manage_billing' as const]
}

beforeEach(() => {
  vi.restoreAllMocks()
  clearAuthToken()
  if (typeof globalThis.localStorage !== 'undefined') {
    globalThis.localStorage.clear()
  }
})

describe('ApiClientError', () => {
  it('is correctly identified by instanceof', () => {
    const err = new ApiClientError('test', 401)
    expect(err instanceof ApiClientError).toBe(true)
    expect(err instanceof Error).toBe(true)
    expect(err.status).toBe(401)
    expect(err.name).toBe('ApiClientError')
    expect(err.message).toBe('test')
  })

  it('supports undefined status', () => {
    const err = new ApiClientError('Network error')
    expect(err.status).toBeUndefined()
    expect(err instanceof ApiClientError).toBe(true)
  })

  it('instanceof works when thrown and caught', () => {
    let caught: unknown
    try {
      throw new ApiClientError('thrown', 403)
    } catch (error) {
      caught = error
    }
    expect(caught instanceof ApiClientError).toBe(true)
    expect((caught as ApiClientError).status).toBe(403)
  })
})

describe('clientApi.restoreSession', () => {
  it('returns false when refresh is rejected as unauthorized', async () => {
    const refreshSpy = vi
      .spyOn(clientApi, 'refreshSession')
      .mockRejectedValueOnce(new ApiClientError('Unauthorized', 401))

    await expect(clientApi.restoreSession()).resolves.toBe(false)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent restore attempts within a tab', async () => {
    let resolveRefresh!: () => void
    const refreshSpy = vi.spyOn(clientApi, 'refreshSession').mockImplementationOnce(
      () =>
        new Promise<AuthResponse>((resolve) => {
          resolveRefresh = () => {
            writeAuthToken('restored-access-token')
            resolve({
              token: 'restored-access-token',
              user: {
                id: restoredPrincipal.userId,
                email: restoredPrincipal.email,
                name: 'Restored User',
                createdAt: '2026-05-22T00:00:00.000Z'
              }
            })
          }
        })
    )

    const firstRestore = clientApi.restoreSession()
    const secondRestore = clientApi.restoreSession()

    await vi.waitFor(() => {
      expect(refreshSpy).toHaveBeenCalledTimes(1)
    })

    resolveRefresh()

    await expect(Promise.all([firstRestore, secondRestore])).resolves.toEqual([true, true])
    expect(readAuthToken()).toBe('restored-access-token')
  })
})

describe('restoreCurrentPrincipal', () => {
  it('uses the principal returned by refresh instead of making a second /me request', async () => {
    const refreshSpy = vi.spyOn(clientApi, 'refreshSession').mockImplementationOnce(() => {
      writeAuthToken('restored-access-token')
      return Promise.resolve({
        token: 'restored-access-token',
        user: {
          id: restoredPrincipal.userId,
          email: restoredPrincipal.email,
          name: 'Restored User',
          createdAt: '2026-05-22T00:00:00.000Z'
        },
        principal: restoredPrincipal
      })
    })
    const meSpy = vi.spyOn(clientApi, 'me').mockResolvedValueOnce({
      ...restoredPrincipal,
      email: 'should-not-load@example.com'
    })

    await expect(restoreCurrentPrincipal()).resolves.toEqual(restoredPrincipal)

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(meSpy).not.toHaveBeenCalled()
    expect(readAuthToken()).toBe('restored-access-token')
  })

  it('falls back to /me when an older refresh response has no principal', async () => {
    const refreshSpy = vi.spyOn(clientApi, 'refreshSession').mockImplementationOnce(() => {
      writeAuthToken('legacy-restored-access-token')
      return Promise.resolve({
        token: 'legacy-restored-access-token',
        user: {
          id: restoredPrincipal.userId,
          email: restoredPrincipal.email,
          name: 'Restored User',
          createdAt: '2026-05-22T00:00:00.000Z'
        }
      })
    })
    const meSpy = vi.spyOn(clientApi, 'me').mockResolvedValueOnce(restoredPrincipal)

    await expect(restoreCurrentPrincipal()).resolves.toEqual(restoredPrincipal)

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(meSpy).toHaveBeenCalledTimes(1)
    expect(readAuthToken()).toBe('legacy-restored-access-token')
  })
})
