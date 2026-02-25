import type { Attributes, Counter, Histogram, Meter } from '@opentelemetry/api'

export const httpClientRequestCountMetricName =
  'tx_agent_kit_client_http_request_total'
export const httpClientRequestDurationMetricName =
  'tx_agent_kit_client_http_request_duration'
export const nodeServiceStartupMetricName = 'tx_agent_kit_node_service_startup_total'

export interface HttpClientMetrics {
  readonly requestCounter: Counter<Attributes>
  readonly requestDurationHistogram: Histogram<Attributes>
}

export interface NodeServiceMetrics {
  readonly startupCounter: Counter<Attributes>
}

export interface HttpClientMeter {
  readonly createCounter: Meter['createCounter']
  readonly createHistogram: Meter['createHistogram']
}

export interface NodeServiceMeter {
  readonly createCounter: Meter['createCounter']
}

const httpClientMetricsRegistry = new Map<HttpClientMeter, HttpClientMetrics>()
const nodeServiceMetricsRegistry = new Map<NodeServiceMeter, NodeServiceMetrics>()

export const getOrCreateHttpClientMetrics = (
  meter: HttpClientMeter
): HttpClientMetrics => {
  const existing = httpClientMetricsRegistry.get(meter)
  if (existing) {
    return existing
  }

  const created: HttpClientMetrics = {
    requestCounter: meter.createCounter(httpClientRequestCountMetricName, {
      unit: '{request}',
      description: 'Total HTTP requests emitted by client applications.'
    }),
    requestDurationHistogram: meter.createHistogram(
      httpClientRequestDurationMetricName,
      {
        unit: 'ms',
        description: 'HTTP request duration in milliseconds emitted by client applications.'
      }
    )
  }

  httpClientMetricsRegistry.set(meter, created)
  return created
}

export const getOrCreateNodeServiceMetrics = (
  meter: NodeServiceMeter
): NodeServiceMetrics => {
  const existing = nodeServiceMetricsRegistry.get(meter)
  if (existing) {
    return existing
  }

  const created: NodeServiceMetrics = {
    startupCounter: meter.createCounter(nodeServiceStartupMetricName, {
      unit: '{startup}',
      description: 'Service startup events emitted by Node.js runtimes.'
    })
  }

  nodeServiceMetricsRegistry.set(meter, created)
  return created
}

export const _resetMetricsRegistryForTest = (): void => {
  httpClientMetricsRegistry.clear()
  nodeServiceMetricsRegistry.clear()
}
