import { clearAuthToken, readAuthToken } from './auth-token'
import { ApiClientError } from './client-api'

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
  if (!(error instanceof ApiClientError) || error.status !== 401) {
    return false
  }

  clearAuthToken()
  router.replace(buildSignInPath(nextPath))
  return true
}
