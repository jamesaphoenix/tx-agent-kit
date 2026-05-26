import { HttpMiddleware, HttpServerRequest } from '@effect/platform'
import { context, propagation, trace } from '@opentelemetry/api'
import { withEffectSpanContext } from '@tx-agent-kit/observability'
import { Effect } from 'effect'

export const traceContextMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const extractedContext = propagation.extract(context.active(), request.headers)
    const spanContext = trace.getSpanContext(extractedContext)

    if (!spanContext) {
      return yield* httpApp
    }

    return yield* withEffectSpanContext(spanContext)(httpApp)
  })
)
