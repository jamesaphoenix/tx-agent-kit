import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAuthToken,
  clearRefreshToken,
  readAuthToken,
  readRefreshToken,
  writeAuthToken,
  writeRefreshToken
} from './auth-token'

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

describe('auth-token', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key]
    }
  })

  it('returns null when no token is stored', async () => {
    const token = await readAuthToken()
    expect(token).toBeNull()
  })

  it('writes and reads a token', async () => {
    await writeAuthToken('test-jwt-token')
    const token = await readAuthToken()
    expect(token).toBe('test-jwt-token')
  })

  it('clears a stored token', async () => {
    await writeAuthToken('test-jwt-token')
    await clearAuthToken()
    const token = await readAuthToken()
    expect(token).toBeNull()
  })

  it('writes and clears refresh tokens', async () => {
    await writeRefreshToken('refresh-token')
    expect(await readRefreshToken()).toBe('refresh-token')
    await clearRefreshToken()
    expect(await readRefreshToken()).toBeNull()
  })
})
