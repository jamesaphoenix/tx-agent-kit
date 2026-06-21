import { AsyncLocalStorage } from 'node:async_hooks'

export interface ApiRequestContext {
  readonly method?: string
  readonly path?: string
  readonly routePattern?: string
  readonly operationId?: string
  // Mutable per-request cell: flipped to true once the error boundary
  // (mapCoreError) has logged a fault for this request, so the last-resort
  // effectCauseLoggingMiddleware can skip re-logging the same fault. Created
  // fresh per request in enter/run below.
  readonly errorReported?: { value: boolean }
  // Mutable per-request cell holding the caller's user id once their session
  // token has been verified. The auth-principal-stamp middleware fills it
  // (BEFORE the route handler decodes params) so the error boundary can tell an
  // authenticated caller's request-validation failure (a real contract
  // violation) from anonymous noise. Holds only the id, not a full principal:
  // the verification is stateless (no DB), so this stays a cheap pre-decode hook.
  readonly authUserId?: { value: string | null }
}

const requestContextStorage = new AsyncLocalStorage<ApiRequestContext>()

const withRequestCells = (context: ApiRequestContext): ApiRequestContext => ({
  errorReported: { value: false },
  authUserId: { value: null },
  ...context
})

export const parseRequestPathname = (rawUrl: string): string => {
  try {
    return new URL(rawUrl, 'http://localhost').pathname
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl
  }
}

export const enterApiRequestContext = (context: ApiRequestContext): void => {
  requestContextStorage.enterWith(withRequestCells(context))
}

export const getApiRequestContext = (): ApiRequestContext =>
  requestContextStorage.getStore() ?? {}

export const runWithApiRequestContext = <A>(
  context: ApiRequestContext,
  fn: () => A
): A => requestContextStorage.run(withRequestCells(context), fn)

/**
 * Mark that this request's fault has already been logged at the error boundary
 * (mapCoreError). No-ops if no request context is active — so it never throws.
 */
export const markApiErrorReported = (): void => {
  const cell = requestContextStorage.getStore()?.errorReported
  if (cell) {
    cell.value = true
  }
}

/**
 * True only when mapCoreError already logged this request's fault. Fails OPEN:
 * if no context cell is active it returns false, so the last-resort middleware
 * still logs — a missing cell can never silence a fault, only (rarely) double-log.
 */
export const wasApiErrorReported = (): boolean =>
  requestContextStorage.getStore()?.errorReported?.value === true

/**
 * Record the verified caller's user id for this request. No-ops if no request
 * context is active (so it never throws outside a request scope).
 */
export const setApiRequestAuthUserId = (userId: string): void => {
  const cell = requestContextStorage.getStore()?.authUserId
  if (cell) {
    cell.value = userId
  }
}

/**
 * The caller's user id when their session token was verified for this request
 * (by the auth-principal-stamp middleware), else null (anonymous / unverified).
 */
export const getApiRequestAuthUserId = (): string | null =>
  requestContextStorage.getStore()?.authUserId?.value ?? null
