import type { Counter, Gauge, Meter } from '@opentelemetry/api'

import { getMetricsMeter } from './metrics-meter.js'

export const outboxUnprocessedCountMetricName = 'tx_agent_kit_outbox_unprocessed_count'
export const outboxUnprocessedAgeMetricName =
  'tx_agent_kit_outbox_unprocessed_age_seconds'
export const outboxBatchDispatchedMetricName = 'tx_agent_kit_outbox_batch_dispatched_total'
export const outboxBatchFillRatioMetricName = 'tx_agent_kit_outbox_batch_fill_ratio'
export const outboxListenerConnectedMetricName =
  'tx_agent_kit_outbox_listener_connected'

export interface OutboxMetrics {
  readonly outboxUnprocessedCountGauge: Gauge
  readonly outboxUnprocessedAgeGauge: Gauge
  readonly outboxBatchDispatchedCounter: Counter
  readonly outboxBatchFillRatioGauge: Gauge
  readonly outboxListenerConnectedGauge: Gauge
}

const registry = new Map<Meter, OutboxMetrics>()

export const getOrCreateOutboxMetrics = (meter: Meter): OutboxMetrics => {
  const existing = registry.get(meter)
  if (existing) {
    return existing
  }

  const created: OutboxMetrics = {
    outboxUnprocessedCountGauge: meter.createGauge(outboxUnprocessedCountMetricName, {
      unit: '{event}',
      description: 'Outbox queue depth: count of unprocessed outbox rows at last poll.'
    }),
    outboxUnprocessedAgeGauge: meter.createGauge(outboxUnprocessedAgeMetricName, {
      // Annotation unit so the Prometheus/GMP exporter does NOT append `_seconds`
      // (the metric name already ends in `_seconds`) to avoid `..._age_seconds_seconds`.
      unit: '{second}',
      description: 'Age in seconds of the oldest unprocessed outbox row at last poll.'
    }),
    outboxBatchDispatchedCounter: meter.createCounter(outboxBatchDispatchedMetricName, {
      unit: '{event}',
      description: 'Outbox events dispatched to workflows per drain tick (drain rate).'
    }),
    outboxBatchFillRatioGauge: meter.createGauge(outboxBatchFillRatioMetricName, {
      unit: '1',
      description:
        'Outbox dispatcher saturation: dispatched events / batch capacity per tick (0..1). Sustained high values mean the dispatcher cannot keep up, so scale workers or raise the batch size.'
    }),
    outboxListenerConnectedGauge: meter.createGauge(outboxListenerConnectedMetricName, {
      unit: '1',
      description:
        'Outbox Postgres LISTEN session health: 1 when connected, 0 while disconnected or reconnecting.'
    })
  }

  registry.set(meter, created)
  return created
}

const metricsForCurrentMeter = (): OutboxMetrics =>
  getOrCreateOutboxMetrics(getMetricsMeter())

export const recordOutboxBatchDispatched = (count: number): void => {
  if (count > 0) {
    metricsForCurrentMeter().outboxBatchDispatchedCounter.add(count)
  }
}

export const recordOutboxBacklog = (backlog: {
  readonly unprocessedCount: number
  readonly oldestAgeSeconds: number
}): void => {
  const m = metricsForCurrentMeter()
  m.outboxUnprocessedCountGauge.record(backlog.unprocessedCount)
  m.outboxUnprocessedAgeGauge.record(backlog.oldestAgeSeconds)
}

/**
 * Records outbox dispatcher saturation as a 0..1 fill ratio (dispatched / capacity).
 * Drives the "dispatcher near capacity" alert: sustained >0.8 means scale workers
 * or raise the drain batch size.
 */
export const recordOutboxBatchFill = (dispatched: number, batchSize: number): void => {
  const ratio = batchSize > 0 ? dispatched / batchSize : 0
  metricsForCurrentMeter().outboxBatchFillRatioGauge.record(ratio)
}

export const recordOutboxListenerConnected = (connected: boolean): void => {
  metricsForCurrentMeter().outboxListenerConnectedGauge.record(connected ? 1 : 0)
}

export const _resetOutboxMetricsRegistryForTest = (): void => {
  registry.clear()
}
