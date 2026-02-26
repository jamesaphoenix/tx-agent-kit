import { clearAuthToken, clearRefreshToken, readAuthToken } from './auth-token'
import { ApiClientError } from './client-api'
import { sessionStoreActions } from '../stores/session-store'

interface RouterLike {
  replace: (path: string) => void
}

const buildSignInPath = (nextPath: string): string => {
  return `/sign-in?next=${encodeURIComponent(nextPath)}`
}

export const ensureSessionOrRedirect = async (
  router: RouterLike,
  nextPath: string
): Promise<boolean> => {
  const token = await readAuthToken()

  if (token) {
    return true
  }

  router.replace(buildSignInPath(nextPath))
  return false
}

export const handleUnauthorizedApiError = async (
  error: unknown,
  router: RouterLike,
  nextPath: string
): Promise<boolean> => {
  if (!(error instanceof ApiClientError) || (error.status !== 401 && error.status !== 403)) {
    return false
  }

  await clearAuthToken()
  await clearRefreshToken()
  sessionStoreActions.clear()
  router.replace(buildSignInPath(nextPath))
  return true
}
