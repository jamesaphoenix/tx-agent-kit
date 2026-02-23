import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthPrincipal } from '@tx-agent-kit/contracts'
import {
  sessionStore,
  sessionStoreActions,
  sessionStoreInitialState,
  sessionStoreSelectors
} from './session-store'

const makePrincipal = (overrides?: Partial<AuthPrincipal>): AuthPrincipal => ({
  userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  email: 'test@example.com',
  roles: ['member'],
  ...overrides
})

describe('session-store', () => {
  beforeEach(() => {
    sessionStore.setState(() => ({ ...sessionStoreInitialState }))
  })

  it('starts with null principal and isReady false', () => {
    const state = sessionStore.state
    expect(state.principal).toBeNull()
    expect(state.isReady).toBe(false)
  })

  it('setPrincipal sets principal and marks ready', () => {
    const principal = makePrincipal()
    sessionStoreActions.setPrincipal(principal)

    const state = sessionStore.state
    expect(state.principal).toEqual(principal)
    expect(state.isReady).toBe(true)
  })

  it('setPrincipal with null clears principal but keeps ready', () => {
    sessionStoreActions.setPrincipal(makePrincipal())
    sessionStoreActions.setPrincipal(null)

    const state = sessionStore.state
    expect(state.principal).toBeNull()
    expect(state.isReady).toBe(true)
  })

  it('clear resets to initial state but keeps ready', () => {
    sessionStoreActions.setPrincipal(makePrincipal())
    sessionStoreActions.clear()

    const state = sessionStore.state
    expect(state.principal).toBeNull()
    expect(state.isReady).toBe(true)
  })

  it('clear sets isReady true even from cold start', () => {
    // Store starts with isReady: false (from beforeEach reset)
    expect(sessionStore.state.isReady).toBe(false)
    sessionStoreActions.clear()
    expect(sessionStore.state.isReady).toBe(true)
    expect(sessionStore.state.principal).toBeNull()
  })

})

describe('session-store selectors', () => {
  it('getPrincipal returns the principal', () => {
    const principal = makePrincipal()
    expect(sessionStoreSelectors.getPrincipal({ principal, isReady: true })).toEqual(principal)
  })

  it('getIsReady returns isReady', () => {
    expect(sessionStoreSelectors.getIsReady({ principal: null, isReady: false })).toBe(false)
    expect(sessionStoreSelectors.getIsReady({ principal: null, isReady: true })).toBe(true)
  })

  it('getIsAuthenticated returns true when principal exists', () => {
    const principal = makePrincipal()
    expect(sessionStoreSelectors.getIsAuthenticated({ principal, isReady: true })).toBe(true)
    expect(sessionStoreSelectors.getIsAuthenticated({ principal: null, isReady: true })).toBe(false)
  })
})
