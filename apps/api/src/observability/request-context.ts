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
}

const requestContextStorage = new AsyncLocalStorage<ApiRequestContext>()

const withErrorReportedCell = (context: ApiRequestContext): ApiRequestContext => ({
  errorReported: { value: false },
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
  requestContextStorage.enterWith(withErrorReportedCell(context))
}

export const getApiRequestContext = (): ApiRequestContext =>
  requestContextStorage.getStore() ?? {}

export const runWithApiRequestContext = <A>(
  context: ApiRequestContext,
  fn: () => A
): A => requestContextStorage.run(withErrorReportedCell(context), fn)

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
