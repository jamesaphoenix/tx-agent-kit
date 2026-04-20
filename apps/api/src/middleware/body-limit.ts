import * as IncomingMessage from '@effect/platform/HttpIncomingMessage'
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform'
import { Effect, Option } from 'effect'

const MAX_BYTES = 1024 * 1024
const UPLOAD_CONTENT_MAX_BYTES = 210 * 1024 * 1024
const uploadContentPathPattern = /^\/v1\/teams\/[^/]+\/uploads\/[^/]+\/content$/

const parsePathname = (rawUrl: string): string => {
  try {
    return new URL(rawUrl, 'http://localhost').pathname
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl
  }
}

export const bodyLimitMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const pathname = parsePathname(request.url)
    const maxBytes = request.method === 'PUT' && uploadContentPathPattern.test(pathname)
      ? UPLOAD_CONTENT_MAX_BYTES
      : MAX_BYTES
    const contentLength = request.headers['content-length']

    if (contentLength) {
      const size = Number.parseInt(contentLength, 10)
      if (!Number.isNaN(size) && size > maxBytes) {
        return yield* HttpServerResponse.json(
          {
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: `Request body exceeds ${maxBytes} bytes`
            }
          },
          { status: 413 }
        ).pipe(Effect.orDie)
      }
    }

    return yield* IncomingMessage.withMaxBodySize(httpApp, Option.some(maxBytes))
  })
)
