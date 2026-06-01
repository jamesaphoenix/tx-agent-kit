import { HttpMiddleware, HttpServerRequest } from '@effect/platform'
import { Effect } from 'effect'
import {
  enterApiRequestContext,
  parseRequestPathname
} from '../observability/request-context.js'

// Establishes the per-request AsyncLocalStorage context (method + path, plus the
// errorReported dedup cell) for the rest of the pipeline. MUST be wired before
// effectCauseLoggingMiddleware so the cell exists when the boundary marks it.
export const requestContextMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    yield* Effect.sync(() => {
      enterApiRequestContext({
        method: request.method,
        path: parseRequestPathname(request.url)
      })
    })
    return yield* httpApp
  })
)
