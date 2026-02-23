import { describe, expect, it, vi, type Mock } from 'vitest'
import { useLocalSearchParams } from 'expo-router'
import { useSafeNextPath } from './url-state'

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { API_BASE_URL: 'http://localhost:4000' } } }
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}))

vi.mock('expo-router', () => ({
  useLocalSearchParams: vi.fn()
}))

const mockParams = useLocalSearchParams as Mock

// useSafeNextPath only calls the mocked useLocalSearchParams (no real React hooks),
// so it can be invoked directly in tests.

describe('useSafeNextPath', () => {
  it('returns a valid internal path', () => {
    mockParams.mockReturnValue({ next: '/dashboard' })
    expect(useSafeNextPath()).toBe('/dashboard')
  })

  it('returns fallback when next is undefined', () => {
    mockParams.mockReturnValue({})
    expect(useSafeNextPath()).toBe('/dashboard')
  })

  it('returns custom fallback when specified', () => {
    mockParams.mockReturnValue({})
    expect(useSafeNextPath('/workspaces')).toBe('/workspaces')
  })

  it('returns fallback for array values', () => {
    mockParams.mockReturnValue({ next: ['/a', '/b'] })
    expect(useSafeNextPath()).toBe('/dashboard')
  })

  it('rejects external URLs without leading slash', () => {
    mockParams.mockReturnValue({ next: 'https://evil.com' })
    expect(useSafeNextPath()).toBe('/dashboard')
  })

  it('rejects javascript: protocol', () => {
    mockParams.mockReturnValue({ next: 'javascript:alert(1)' })
    expect(useSafeNextPath()).toBe('/dashboard')
  })

  it('rejects protocol-relative URLs (//evil.com)', () => {
    mockParams.mockReturnValue({ next: '//evil.com/path' })
    expect(useSafeNextPath()).toBe('/dashboard')
  })

  it('preserves query parameters in valid paths', () => {
    mockParams.mockReturnValue({ next: '/workspaces?tab=active' })
    expect(useSafeNextPath()).toBe('/workspaces?tab=active')
  })
})
