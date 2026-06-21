import type { Counter, Meter } from '@opentelemetry/api'

import { getMetricsMeter } from './metrics-meter.js'

export const apiRequestValidationRejectedMetricName = 'tx_agent_kit_api_request_validation_rejected_total'

export interface ValidationMetrics {
  readonly rejectionCounter: Counter
}

const registry = new Map<Meter, ValidationMetrics>()

export const getOrCreateValidationMetrics = (meter: Meter): ValidationMetrics => {
  const existing = registry.get(meter)
  if (existing) {
    return existing
  }

  const created: ValidationMetrics = {
    rejectionCounter: meter.createCounter(apiRequestValidationRejectedMetricName, {
      unit: '{rejection}',
      description:
        'Request-validation rejections (HttpApiDecodeError 4xx), by operation, offending field, and whether the caller was authenticated.'
    })
  }

  registry.set(meter, created)
  return created
}

const metricsForCurrentMeter = (): ValidationMetrics =>
  getOrCreateValidationMetrics(getMetricsMeter())

/**
 * Record one request-validation rejection. Labels are deliberately low-cardinality
 * (bounded operation id, schema field name, and an authenticated boolean) so the
 * counter is alertable on a *spike* — e.g. an authenticated client regression — and
 * the offending VALUE never lands here (it goes to the structured warn log instead).
 */
export const recordValidationRejection = (rejection: {
  readonly operationId?: string
  readonly field: string
  readonly authenticated: boolean
}): void => {
  const m = metricsForCurrentMeter()
  m.rejectionCounter.add(1, {
    operation_id: rejection.operationId ?? 'unknown',
    field: rejection.field,
    authenticated: rejection.authenticated ? 'true' : 'false'
  })
}

export const _resetValidationMetricsRegistryForTest = (): void => {
  registry.clear()
}
