import { HttpMiddleware, HttpServerRequest } from '@effect/platform'
import { createLogger } from '@tx-agent-kit/logging'
import { recordValidationRejection } from '@tx-agent-kit/observability'
import {
  buildCauseReportError,
  causeLogContext,
  extractRequestDecodeField,
  shouldLogEffectCause
} from '@tx-agent-kit/observability/effect-cause-summary'
import { Cause, Effect, Option } from 'effect'
import {
  getApiRequestAuthUserId,
  getApiRequestContext,
  markApiErrorReported,
  parseRequestPathname,
  wasApiErrorReported
} from '../observability/request-context.js'
import { captureApiClientContractViolation, captureApiMappedError } from '../observability/sentry.js'

const BOUNDARY_FALLBACK_MESSAGE = 'Unhandled Effect API cause reached route boundary'

const logger = createLogger('tx-agent-kit-api').child('effect-cause-boundary')

// Division of labor for API error logging (log each fault exactly once):
//   - mapCoreError (api.ts) is the PRIMARY boundary: it logs + Sentry-captures
//     every mapped CoreError (4xx at warn, 5xx at error) and marks the request
//     via markApiErrorReported().
//   - This middleware is the LAST-RESORT defect catcher: a cause that reached
//     the route boundary WITHOUT going through mapCoreError (a Die, an
//     unexpected throw, a middleware fault). If mapCoreError already reported
//     this request, we skip — otherwise we'd double-log/double-capture 500s
//     (shouldLogEffectCause treats InternalError as reportable). The guard fails
//     open: if no request context is active it logs, so faults are never lost.
export const effectCauseLoggingMiddleware = HttpMiddleware.make((httpApp) =>
  httpApp.pipe(
    Effect.tapErrorCause((cause) =>
      Effect.gen(function* () {
        if (wasApiErrorReported()) {
          return
        }

        const request = yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest)
        const requestContext = Option.isSome(request)
          ? {
              method: request.value.method,
              path: parseRequestPathname(request.value.url)
            }
          : {}

        // operationId/routePattern are stamped per-request by the routing layer
        // (request-context AsyncLocalStorage); merge them so the boundary report
        // names the offending endpoint instead of just method + path.
        const { operationId, routePattern } = getApiRequestContext()

        // Request-validation rejections (an `HttpApiDecodeError` from a bad
        // path/query/body shape) are client 4xx, not server faults — the framework
        // already returned the 4xx; here we only decide telemetry. Attribute it by
        // caller: the auth-principal-stamp middleware resolved the principal BEFORE
        // decode, so a stamped principal means one of OUR clients sent malformed
        // input (a real contract violation worth a non-paging Sentry signal), while
        // no principal means anonymous noise (metered + warn-logged, never paged).
        const decodeField = extractRequestDecodeField(cause)
        if (decodeField !== null) {
          const userId = getApiRequestAuthUserId()
          const authenticated = userId !== null
          recordValidationRejection({ operationId, field: decodeField, authenticated })
          logger.warn('Rejected malformed request', {
            ...requestContext,
            ...(operationId ? { operationId } : {}),
            ...(routePattern ? { routePattern } : {}),
            field: decodeField,
            authenticated,
            ...(userId ? { userId } : {})
          })
          if (userId !== null) {
            captureApiClientContractViolation(
              buildCauseReportError(cause, {
                fallbackMessage: 'Request contract violation',
                prettyStack: Cause.pretty(cause)
              }),
              {
                ...requestContext,
                ...(operationId ? { operationId } : {}),
                ...(routePattern ? { routePattern } : {}),
                field: decodeField,
                userId
              }
            )
          }
          markApiErrorReported()
          return
        }

        if (!shouldLogEffectCause(cause)) {
          return
        }

        const causePretty = Cause.pretty(cause)
        const causeContext = causeLogContext(cause)

        const context = {
          ...requestContext,
          ...(operationId ? { operationId } : {}),
          ...(routePattern ? { routePattern } : {}),
          ...causeContext,
          causePretty
        }

        const reportMessage = typeof causeContext.rootCauseMessage === 'string'
          ? causeContext.rootCauseMessage
          : BOUNDARY_FALLBACK_MESSAGE

        logger.error(reportMessage, context)
        captureApiMappedError(
          buildCauseReportError(cause, {
            fallbackMessage: BOUNDARY_FALLBACK_MESSAGE,
            prettyStack: causePretty
          }),
          context
        )
      })
    )
  )
)
