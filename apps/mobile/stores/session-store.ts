import type { AuthPrincipal } from '@tx-agent-kit/contracts'
import { Store } from '@tanstack/react-store'

export interface SessionStoreState {
  principal: AuthPrincipal | null
  isReady: boolean
}

export const sessionStoreInitialState: SessionStoreState = {
  principal: null,
  isReady: false
}

export const sessionStore = new Store<SessionStoreState>(sessionStoreInitialState)

export const sessionStoreActions = {
  setPrincipal: (principal: AuthPrincipal | null): void => {
    sessionStore.setState((state) => ({
      ...state,
      principal,
      isReady: true
    }))
  },

  clear: (): void => {
    sessionStore.setState(() => ({
      ...sessionStoreInitialState,
      isReady: true
    }))
  }
}

export const sessionStoreSelectors = {
  getPrincipal: (state: SessionStoreState): AuthPrincipal | null => state.principal,
  getIsReady: (state: SessionStoreState): boolean => state.isReady,
  getIsAuthenticated: (state: SessionStoreState): boolean => state.principal !== null
}
