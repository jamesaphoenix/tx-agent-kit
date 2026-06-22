import { useSelector } from '@tanstack/react-store'
import {
  sessionStore,
  sessionStoreSelectors,
  type SessionStoreState
} from '../stores/session-store'

export const useSessionStore = (): SessionStoreState => {
  return useSelector(sessionStore, (state) => state)
}

export const useSessionStoreSelector = <T,>(selector: (state: SessionStoreState) => T): T => {
  return useSelector(sessionStore, selector)
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
