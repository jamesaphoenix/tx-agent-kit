import {
  metrics,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type Tracer
} from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import {
  ATTR_SERVICE_NAME,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from '@opentelemetry/semantic-conventions'
import { getClientObservabilityEnv } from './env.js'
import { getOrCreateHttpClientMetrics } from './metrics-registry.js'

export interface ClientTelemetryConfig {
  readonly serviceName: string
  readonly otlpEndpoint?: string
  readonly deploymentEnvironment?: string
}

export interface ClientHttpTelemetry {
  readonly tracer: Tracer
  readonly recordRequest: (durationMs: number, attributes: Attributes) => void
}

interface ClientTelemetryState {
  readonly serviceName: string
  readonly otlpEndpoint: string
  readonly deploymentEnvironment: string
  readonly tracerProvider: BasicTracerProvider
  readonly meterProvider: MeterProvider
  readonly requestCounter: Counter<Attributes>
  readonly requestDurationHistogram: Histogram<Attributes>
  readonly tracer: Tracer
}

let clientTelemetryState: ClientTelemetryState | null = null

const resolveClientOtelEndpoint = (
  config: ClientTelemetryConfig
): string =>
  config.otlpEndpoint ?? getClientObservabilityEnv().OTEL_EXPORTER_OTLP_ENDPOINT

const resolveDeploymentEnvironment = (config: ClientTelemetryConfig): string =>
  config.deploymentEnvironment ?? getClientObservabilityEnv().NODE_ENV

const createClientTelemetryState = (
  config: ClientTelemetryConfig
): ClientTelemetryState => {
  const otlpEndpoint = resolveClientOtelEndpoint(config)
  const deploymentEnvironment = resolveDeploymentEnvironment(config)

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment
  })

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${otlpEndpoint}/v1/traces`
        })
      )
    ]
  })

  trace.setGlobalTracerProvider(tracerProvider)
  const tracer = trace.getTracer(config.serviceName)

  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`
    }),
    exportIntervalMillis: 5_000
  })

  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader]
  })

  metrics.setGlobalMeterProvider(meterProvider)
  const meter = meterProvider.getMeter(config.serviceName)

  const { requestCounter, requestDurationHistogram } =
    getOrCreateHttpClientMetrics(meter)

  return {
    serviceName: config.serviceName,
    otlpEndpoint,
    deploymentEnvironment,
    tracerProvider,
    meterProvider,
    requestCounter,
    requestDurationHistogram,
    tracer
  }
}

const isSameClientTelemetryConfig = (
  state: ClientTelemetryState,
  config: ClientTelemetryConfig
): boolean => {
  const otlpEndpoint = resolveClientOtelEndpoint(config)
  const deploymentEnvironment = resolveDeploymentEnvironment(config)

  return (
    state.serviceName === config.serviceName &&
    state.otlpEndpoint === otlpEndpoint &&
    state.deploymentEnvironment === deploymentEnvironment
  )
}

const shutdownClientTelemetryState = async (
  state: ClientTelemetryState
): Promise<void> => {
  await Promise.all([
    Promise.resolve(state.tracerProvider.shutdown()),
    Promise.resolve(state.meterProvider.shutdown())
  ])
}

const getOrCreateClientTelemetryState = (
  config: ClientTelemetryConfig
): ClientTelemetryState => {
  if (clientTelemetryState && isSameClientTelemetryConfig(clientTelemetryState, config)) {
    return clientTelemetryState
  }

  if (clientTelemetryState) {
    const staleState = clientTelemetryState
    clientTelemetryState = null
    void shutdownClientTelemetryState(staleState)
  }

  clientTelemetryState = createClientTelemetryState(config)
  return clientTelemetryState
}

export const getClientHttpTelemetry = (
  config: ClientTelemetryConfig
): ClientHttpTelemetry => {
  const state = getOrCreateClientTelemetryState(config)

  return {
    tracer: state.tracer,
    recordRequest: (durationMs: number, attributes: Attributes) => {
      state.requestCounter.add(1, attributes)
      state.requestDurationHistogram.record(durationMs, attributes)
    }
  }
}

export const emitClientTelemetrySmoke = (
  config: ClientTelemetryConfig
): void => {
  const telemetry = getClientHttpTelemetry(config)
  const span = telemetry.tracer.startSpan('observability.smoke.client')
  span.setAttribute('smoke.service', config.serviceName)
  span.end()

  telemetry.recordRequest(5, {
    'http.request.method': 'GET',
    'url.path': '/observability/smoke',
    'http.response.status_code': 200
  })
}

export const stopClientTelemetry = async (): Promise<void> => {
  if (!clientTelemetryState) {
    return
  }

  const currentState = clientTelemetryState
  clientTelemetryState = null

  await shutdownClientTelemetryState(currentState)
}

export const _resetClientTelemetryForTest = async (): Promise<void> => {
  await stopClientTelemetry()
}
