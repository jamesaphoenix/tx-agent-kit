type MaybePromise<T> = T | Promise<T>

export interface AuthStatusError {
  readonly status: number | undefined
}

export interface AuthRequestDescriptor {
  readonly method?: string
  readonly url?: string
}

export interface CreateSessionRestorerOptions {
  readonly hasAccessToken: () => MaybePromise<boolean>
  readonly canRefreshSession: () => MaybePromise<boolean>
  readonly refreshSession: () => MaybePromise<void>
  readonly serializeRefresh?: <T>(callback: () => Promise<T>) => Promise<T>
}

export interface RestoreAuthenticatedPrincipalOptions<Principal> {
  readonly restoreSession: () => MaybePromise<boolean>
  readonly loadPrincipal: () => MaybePromise<Principal>
  readonly clearCredentialsOnAuthError?: () => MaybePromise<void>
}

const browserAuthSessionRequestKeys = new Set([
  'GET /v1/auth/google/start',
  'POST /v1/auth/refresh',
  'POST /v1/auth/sign-in',
  'POST /v1/auth/sign-up'
])

const resolveRequestPath = (url: string | undefined): string => {
  if (!url) {
    return '/'
  }

  try {
    return new URL(url, 'http://localhost').pathname
  } catch {
    return url
  }
}

const toRequestKey = (request: AuthRequestDescriptor): string =>
  `${(request.method ?? 'GET').toUpperCase()} ${resolveRequestPath(request.url)}`

export const isAuthStatus = (status: number | undefined): boolean =>
  status === 401 || status === 403

export const isAuthStatusError = (error: unknown): error is AuthStatusError => {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return false
  }

  const status = (error as { readonly status?: unknown }).status
  return typeof status === 'number' && isAuthStatus(status)
}

export const buildSignInPath = (nextPath: string): string =>
  `/sign-in?next=${encodeURIComponent(nextPath)}`

export const usesBrowserAuthSessionMode = (
  request: AuthRequestDescriptor
): boolean => browserAuthSessionRequestKeys.has(toRequestKey(request))

export const createSessionRestorer = ({
  hasAccessToken,
  canRefreshSession,
  refreshSession,
  serializeRefresh
}: CreateSessionRestorerOptions): (() => Promise<boolean>) => {
  let restoreSessionPromise: Promise<boolean> | null = null

  return async (): Promise<boolean> => {
    if (await hasAccessToken()) {
      return true
    }

    if (restoreSessionPromise !== null) {
      return restoreSessionPromise
    }

    const runRestore = async (): Promise<boolean> => {
      if (await hasAccessToken()) {
        return true
      }

      if (!(await canRefreshSession())) {
        return false
      }

      try {
        await refreshSession()
        return true
      } catch (error) {
        if (isAuthStatusError(error)) {
          return false
        }

        throw error
      }
    }

    const nextPromise = Promise.resolve(
      serializeRefresh ? serializeRefresh(runRestore) : runRestore()
    )

    restoreSessionPromise = nextPromise

    try {
      return await nextPromise
    } finally {
      if (restoreSessionPromise === nextPromise) {
        restoreSessionPromise = null
      }
    }
  }
}

export const restoreAuthenticatedPrincipal = async <Principal>({
  restoreSession,
  loadPrincipal,
  clearCredentialsOnAuthError
}: RestoreAuthenticatedPrincipalOptions<Principal>): Promise<Principal | null> => {
  const restored = await restoreSession()

  if (!restored) {
    return null
  }

  try {
    return await loadPrincipal()
  } catch (error) {
    if (isAuthStatusError(error)) {
      await clearCredentialsOnAuthError?.()
      return null
    }

    throw error
  }
}
