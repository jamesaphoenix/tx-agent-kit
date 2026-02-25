import { diag, DiagConsoleLogger, DiagLogLevel, metrics, trace } from '@opentelemetry/api'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  ATTR_SERVICE_NAME,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from '@opentelemetry/semantic-conventions'
import { getObservabilityEnv } from './env.js'
import { getOrCreateNodeServiceMetrics } from './metrics-registry.js'

let telemetrySdk: NodeSDK | undefined

const OtlpLogExporterCtor = OTLPLogExporter as new (options: {
  url: string
}) => OTLPLogExporter
const BatchLogRecordProcessorCtor = BatchLogRecordProcessor as new (
  exporter: OTLPLogExporter
) => BatchLogRecordProcessor

export const startTelemetry = async (serviceName: string): Promise<void> => {
  if (telemetrySdk) {
    return
  }

  const env = getObservabilityEnv()

  if (env.OTEL_LOG_LEVEL === 'debug') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)
  }

  const logRecordProcessors =
    env.OTEL_LOGS_EXPORTER === 'none'
      ? undefined
      : [
          new BatchLogRecordProcessorCtor(
            new OtlpLogExporterCtor({
              url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs`
            })
          )
        ]

  telemetrySdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV
    }),
    ...(logRecordProcessors ? { logRecordProcessors } : {}),
    traceExporter: new OTLPTraceExporter({
      url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`
      }),
      exportIntervalMillis: 5000
    })
  })

  await Promise.resolve(telemetrySdk.start())
}

export const stopTelemetry = async (): Promise<void> => {
  if (!telemetrySdk) {
    return
  }

  await Promise.resolve(telemetrySdk.shutdown())
  telemetrySdk = undefined
}

export const emitNodeTelemetrySmoke = (
  serviceName: string
): void => {
  const tracer = trace.getTracer(serviceName)
  const span = tracer.startSpan('observability.smoke.node')
  span.setAttribute('smoke.service', serviceName)
  span.end()

  const meter = metrics.getMeter(serviceName)
  const { startupCounter } = getOrCreateNodeServiceMetrics(meter)
  startupCounter.add(1, {
    'smoke.service': serviceName
  })
}
