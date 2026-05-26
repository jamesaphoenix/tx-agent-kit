import { HttpApp, HttpMiddleware, type HttpServerRequest, HttpServerResponse } from '@effect/platform'
import { Effect } from 'effect'

const nowMs = (): number => {
  if (typeof globalThis.performance !== 'undefined') {
    return globalThis.performance.now()
  }

  return Date.now()
}

const formatDurationMs = (durationMs: number): string =>
  Math.max(durationMs, 0).toFixed(1)

const makeTimingHeaders = (startedAtMs: number): Record<string, string> => {
  const durationMs = formatDurationMs(nowMs() - startedAtMs)
  return {
    'server-timing': `app;dur=${durationMs}`,
    'x-request-duration-ms': durationMs
  }
}

export const serverTimingMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const startedAtMs = nowMs()
    const preResponseHandler = (
      _request: HttpServerRequest.HttpServerRequest,
      response: HttpServerResponse.HttpServerResponse
    ): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
      Effect.succeed(HttpServerResponse.setHeaders(response, makeTimingHeaders(startedAtMs)))

    return yield* Effect.zipRight(
      HttpApp.appendPreResponseHandler(preResponseHandler),
      httpApp
    )
  })
)
