import * as IncomingMessage from '@effect/platform/HttpIncomingMessage'
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform'
import { Effect, Option } from 'effect'

const MAX_BYTES = 1024 * 1024

export const bodyLimitMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const contentLength = request.headers['content-length']

    if (contentLength) {
      const size = Number.parseInt(contentLength, 10)
      if (!Number.isNaN(size) && size > MAX_BYTES) {
        return yield* HttpServerResponse.json(
          {
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: `Request body exceeds ${MAX_BYTES} bytes`
            }
          },
          { status: 413 }
        ).pipe(Effect.orDie)
      }
    }

    return yield* IncomingMessage.withMaxBodySize(httpApp, Option.some(MAX_BYTES))
  })
)
