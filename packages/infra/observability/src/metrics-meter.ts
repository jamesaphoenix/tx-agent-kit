import { metrics, type Meter } from '@opentelemetry/api'

/**
 * Stable instrumentation scope for all hand-rolled business/technical metrics.
 *
 * Using a single, stable meter name (rather than the per-service name) keeps metric
 * identity consistent across api/worker processes so the same series can be queried in
 * GMP regardless of which service emitted it. Service attribution is carried by the
 * OTEL resource (`service.name`), not the meter scope.
 */
export const METRICS_INSTRUMENTATION_SCOPE = '@tx-agent-kit/metrics'

export const getMetricsMeter = (): Meter =>
  metrics.getMeter(METRICS_INSTRUMENTATION_SCOPE)
