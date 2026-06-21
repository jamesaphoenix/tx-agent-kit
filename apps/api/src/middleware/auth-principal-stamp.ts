import { HttpMiddleware, HttpServerRequest } from '@effect/platform'
import { verifySessionToken } from '@tx-agent-kit/auth'
import { parseBearerToken } from '@tx-agent-kit/core'
import { Effect, Exit } from 'effect'
import { setApiRequestAuthUserId } from '../observability/request-context.js'

// Stamp the verified caller's user id BEFORE the route handler decodes its params.
//
// The framework rejects a malformed request (bad path/query/body shape) with an
// `HttpApiDecodeError` that fires BEFORE the handler body runs — so the handler's
// own `requireAuth` never executes, and the error boundary would otherwise have no
// way to tell an authenticated client's contract violation (a real bug worth
// reporting) from anonymous internet noise. Verifying the session token here, ahead
// of decode, records the caller's id so the boundary can make that call.
//
// Verification is STATELESS (HMAC signature + expiry + claim shape via
// `verifySessionToken`, no DB), so a forged/garbage bearer can't pass — this is
// real validated auth, not a presence heuristic, and it stays a cheap pre-decode
// hook that takes no app services (a global middleware can only see the
// framework-provided context). It does NOT enforce auth or change any response:
// `Effect.exit` swallows every failure, so a missing/invalid token simply leaves
// the request unstamped, and the in-handler `requireAuth` remains the single
// authoritative gate (with its full DB-backed session path).
export const authPrincipalStampMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const verified = yield* Effect.exit(
      parseBearerToken(request.headers.authorization).pipe(Effect.flatMap(verifySessionToken))
    )
    if (Exit.isSuccess(verified)) {
      setApiRequestAuthUserId(verified.value.sub)
    }
    return yield* httpApp
  })
)
