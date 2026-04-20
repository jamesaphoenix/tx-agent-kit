import { buildSignInPath } from '@tx-agent-kit/contracts'
import { clearAuthToken } from './auth-token'
import { getApiErrorStatus } from './axios'
import { sessionStore, sessionStoreActions } from '../stores/session-store'

interface RouterLike {
  replace: (path: string) => void
}

export const ensureSessionOrRedirect = (router: RouterLike, nextPath: string): boolean => {
  const sessionState = sessionStore.state

  if (!sessionState.isReady) {
    return false
  }

  if (sessionState.principal) {
    return true
  }

  router.replace(buildSignInPath(nextPath))
  return false
}

export const handleUnauthorizedApiError = (
  error: unknown,
  router: RouterLike,
  nextPath: string
): boolean => {
  const status = getApiErrorStatus(error) ?? (error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : undefined)
  if (status !== 401) {
    return false
  }

  clearAuthToken()
  sessionStoreActions.clear()
  router.replace(buildSignInPath(nextPath))
  return true
}
