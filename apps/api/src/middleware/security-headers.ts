import { HttpApp, HttpMiddleware, type HttpServerRequest, HttpServerResponse } from '@effect/platform'
import { Effect } from 'effect'

const securityHeaders: Record<string, string> = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-download-options': 'noopen',
  'x-permitted-cross-domain-policies': 'none',
  'cache-control': 'no-store'
}

const preResponseHandler = (
  _request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse
): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
  Effect.succeed(HttpServerResponse.setHeaders(response, securityHeaders))

export const securityHeadersMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.zipRight(
    HttpApp.appendPreResponseHandler(preResponseHandler),
    httpApp
  )
)
