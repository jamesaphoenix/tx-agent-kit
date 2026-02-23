import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useStore } from '@tanstack/react-store'
import {
  useSessionStore,
  useSessionStoreSelector,
  useCurrentPrincipal,
  useIsSessionReady,
  useIsAuthenticated
} from './use-session-store'
import {
  sessionStore,
  sessionStoreSelectors,
  type SessionStoreState
} from '../stores/session-store'

vi.mock('@tanstack/react-store', () => ({
  useStore: vi.fn()
}))

vi.mock('../stores/session-store', () => ({
  sessionStore: { state: {} },
  sessionStoreSelectors: {
    getPrincipal: vi.fn((s: SessionStoreState) => s.principal),
    getIsReady: vi.fn((s: SessionStoreState) => s.isReady),
    getIsAuthenticated: vi.fn((s: SessionStoreState) => s.principal !== null)
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSessionStore', () => {
  it('passes sessionStore and identity selector to useStore', () => {
    const fakeState: SessionStoreState = { principal: null, isReady: false }
    ;(useStore as Mock).mockReturnValue(fakeState)

    const result = useSessionStore()

    expect(useStore).toHaveBeenCalledWith(sessionStore, expect.any(Function))
    expect(result).toBe(fakeState)

    // Verify the identity selector returns the full state object
    const calledSelector = (useStore as Mock).mock.calls[0][1] as (s: SessionStoreState) => SessionStoreState
    const testState: SessionStoreState = { principal: { userId: 'u-1', email: 'a@b.com', roles: ['member'] }, isReady: true }
    expect(calledSelector(testState)).toBe(testState)
  })
})

describe('useSessionStoreSelector', () => {
  it('passes custom selector to useStore', () => {
    const selector = (s: SessionStoreState) => s.isReady
    ;(useStore as Mock).mockReturnValue(true)

    const result = useSessionStoreSelector(selector)

    expect(useStore).toHaveBeenCalledWith(sessionStore, selector)
    expect(result).toBe(true)
  })
})

describe('useCurrentPrincipal', () => {
  it('uses getPrincipal selector', () => {
    const principal = { userId: 'u-1', email: 'a@b.com', roles: ['member'] as readonly string[] }
    ;(useStore as Mock).mockReturnValue(principal)

    const result = useCurrentPrincipal()

    expect(useStore).toHaveBeenCalledWith(sessionStore, sessionStoreSelectors.getPrincipal)
    expect(result).toBe(principal)
  })

  it('returns null when no principal', () => {
    ;(useStore as Mock).mockReturnValue(null)

    const result = useCurrentPrincipal()

    expect(result).toBeNull()
  })
})

describe('useIsSessionReady', () => {
  it('uses getIsReady selector', () => {
    ;(useStore as Mock).mockReturnValue(true)

    const result = useIsSessionReady()

    expect(useStore).toHaveBeenCalledWith(sessionStore, sessionStoreSelectors.getIsReady)
    expect(result).toBe(true)
  })
})

describe('useIsAuthenticated', () => {
  it('uses getIsAuthenticated selector', () => {
    ;(useStore as Mock).mockReturnValue(true)

    const result = useIsAuthenticated()

    expect(useStore).toHaveBeenCalledWith(sessionStore, sessionStoreSelectors.getIsAuthenticated)
    expect(result).toBe(true)
  })
})
