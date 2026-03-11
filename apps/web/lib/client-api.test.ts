import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAuthToken, readAuthToken, writeAuthToken } from './auth-token'
import { ApiClientError, clientApi } from './client-api'

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
        new Promise<void>((resolve) => {
          resolveRefresh = () => {
            writeAuthToken('restored-access-token')
            resolve()
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
