import { useStore } from '@tanstack/react-store'
import {
  sessionStore,
  sessionStoreSelectors,
  type SessionStoreState
} from '../stores/session-store'

export const useSessionStore = (): SessionStoreState => {
  return useStore(sessionStore, (state) => state)
}

export const useSessionStoreSelector = <T,>(selector: (state: SessionStoreState) => T): T => {
  return useStore(sessionStore, selector)
}

export const useCurrentPrincipal = () => {
  return useSessionStoreSelector(sessionStoreSelectors.getPrincipal)
}

export const useIsSessionReady = () => {
  return useSessionStoreSelector(sessionStoreSelectors.getIsReady)
}

export const useIsAuthenticated = () => {
  return useSessionStoreSelector(sessionStoreSelectors.getIsAuthenticated)
}
