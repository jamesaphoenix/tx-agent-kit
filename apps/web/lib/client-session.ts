import { clearAuthToken } from './auth-token'
import { sessionStoreActions } from '../stores/session-store'

const clearBrowserSessionStorage = (): void => {
  if (typeof globalThis.window === 'undefined') {
    return
  }

  try {
    globalThis.window.sessionStorage.clear()
  } catch {
    // Ignore disabled or unavailable browser storage; auth state still clears.
  }
}

export const clearClientSessionState = (): void => {
  clearAuthToken()
  sessionStoreActions.clear()
  clearBrowserSessionStorage()
}
