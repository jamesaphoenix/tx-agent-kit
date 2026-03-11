import { buildSignInPath, isAuthStatusError } from '@tx-agent-kit/contracts'
import { clearAuthToken, clearRefreshToken, readAuthToken } from './auth-token'
import { clientApi } from './client-api'
import { sessionStoreActions } from '../stores/session-store'

interface RouterLike {
  replace: (path: string) => void
}

export const ensureSessionOrRedirect = async (
  router: RouterLike,
  nextPath: string
): Promise<boolean> => {
  const token = await readAuthToken()

  if (token) {
    return true
  }

  const restored = await clientApi.restoreSession()
  if (restored) {
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
  if (!isAuthStatusError(error)) {
    return false
  }

  await clearAuthToken()
  await clearRefreshToken()
  sessionStoreActions.clear()
  router.replace(buildSignInPath(nextPath))
  return true
}
