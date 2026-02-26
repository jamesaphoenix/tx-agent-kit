import { clearAuthToken, clearRefreshToken, readAuthToken } from './auth-token'
import { ApiClientError } from './client-api'
import { sessionStoreActions } from '../stores/session-store'

interface RouterLike {
  replace: (path: string) => void
}

const buildSignInPath = (nextPath: string): string => {
  return `/sign-in?next=${encodeURIComponent(nextPath)}`
}

export const ensureSessionOrRedirect = (router: RouterLike, nextPath: string): boolean => {
  if (readAuthToken()) {
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
  if (!(error instanceof ApiClientError) || (error.status !== 401 && error.status !== 403)) {
    return false
  }

  clearAuthToken()
  clearRefreshToken()
  sessionStoreActions.clear()
  router.replace(buildSignInPath(nextPath))
  return true
}
