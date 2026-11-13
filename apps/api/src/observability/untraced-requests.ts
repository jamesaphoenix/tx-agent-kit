import type { HttpServerRequest } from '@effect/platform'
import { isHealthCheckRequestUrl } from '@tx-agent-kit/observability'

/**
 * Requests the Effect HTTP tracer must not open a span for.
 *
 * Load balancer monitors and container healthchecks poll GET /health all day.
 * While a span is current every fiber operation re-enters the OpenTelemetry
 * context, so tracing a probe costs far more than answering it. With no span,
 * a probe runs the handler and nothing else.
 */
export const isUntracedRequest = (request: HttpServerRequest.HttpServerRequest): boolean =>
  isHealthCheckRequestUrl(request.url)
