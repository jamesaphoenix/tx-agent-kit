import { diag, DiagConsoleLogger, DiagLogLevel, metrics, trace } from '@opentelemetry/api'
import type { Context } from '@opentelemetry/api'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor
} from '@opentelemetry/sdk-trace-base'
import {
  ATTR_SERVICE_NAME
} from '@opentelemetry/semantic-conventions'

import { getObservabilityEnv } from './env.js'
import { createLangfuseSpanProcessor } from './langfuse.js'
import { getOrCreateNodeServiceMetrics } from './metrics-registry.js'

export {
  makeEffectOtelLayer,
  makeEffectOtelResourceConfig,
  withEffectSpanContext,
  type EffectOtelLayerConfig,
  type EffectOtelResourceConfig
} from './effect.js'

export { METRICS_INSTRUMENTATION_SCOPE, getMetricsMeter } from './metrics-meter.js'
export {
  authRateLimitRejectedMetricName,
  getOrCreateAuthSecurityMetrics,
  recordAuthRateLimitRejected,
  recordTurnstileVerification,
  turnstileVerificationMetricName,
  _resetAuthSecurityMetricsRegistryForTest,
  type AuthSecurityMetrics,
  type TurnstileVerificationResult
} from './auth-metrics.js'

export {
  outboxUnprocessedCountMetricName,
  outboxUnprocessedAgeMetricName,
  outboxBatchDispatchedMetricName,
  outboxBatchFillRatioMetricName,
  outboxListenerConnectedMetricName,
  getOrCreateOutboxMetrics,
  recordOutboxBatchDispatched,
  recordOutboxBacklog,
  recordOutboxBatchFill,
  recordOutboxListenerConnected,
  _resetOutboxMetricsRegistryForTest,
  type OutboxMetrics
} from './outbox-metrics.js'

export {
  describeCauseForLog,
  summarizeCause,
  flattenCauseSummary,
  toFlattenedCauseChain,
  shouldLogEffectCause,
  causeLogContext,
  buildCauseReportError,
  findRootCauseError,
  type CauseSummary,
  type FlattenedCauseSummary
} from './effect-cause-summary.js'

/**
 * Stable semantic convention for deployment environment.
 * Replaces deprecated SEMRESATTRS_DEPLOYMENT_ENVIRONMENT ('deployment.environment').
 * @see https://opentelemetry.io/docs/specs/semconv/resource/deployment-environment/
 */
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = 'deployment.environment.name'

let telemetrySdk: NodeSDK | undefined

interface TelemetryInstrumentationScope {
  readonly name: string
  readonly version?: string
  readonly schemaUrl?: string
}

const fallbackTemporalWorkflowInstrumentationScope: TelemetryInstrumentationScope = Object.freeze({
  name: '@temporalio/interceptors-opentelemetry/workflow'
})

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const toInstrumentationScope = (
  value: unknown
): TelemetryInstrumentationScope | undefined => {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.length === 0) {
    return undefined
  }

  return {
    name: value.name,
    ...(typeof value.version === 'string' && value.version.length > 0
      ? { version: value.version }
      : {}),
    ...(typeof value.schemaUrl === 'string' && value.schemaUrl.length > 0
      ? { schemaUrl: value.schemaUrl }
      : {})
  }
}

const hasReadableSpanInstrumentationScope = (span: ReadableSpan): boolean =>
  toInstrumentationScope(span.instrumentationScope) !== undefined

const getLegacyReadableSpanInstrumentationScope = (
  span: ReadableSpan
): TelemetryInstrumentationScope | undefined => {
  const legacySpan = span as ReadableSpan & {
    readonly instrumentationLibrary?: unknown
  }
  return toInstrumentationScope(legacySpan.instrumentationLibrary)
}

const withInstrumentationScope = (
  span: ReadableSpan,
  instrumentationScope: TelemetryInstrumentationScope
): ReadableSpan => ({
  ...span,
  instrumentationScope
})

const normalizeReadableSpanInstrumentationScope = (
  span: ReadableSpan
): ReadableSpan => {
  if (hasReadableSpanInstrumentationScope(span)) {
    return span
  }

  const instrumentationScope =
    getLegacyReadableSpanInstrumentationScope(span) ??
    fallbackTemporalWorkflowInstrumentationScope

  return withInstrumentationScope(span, instrumentationScope)
}

class InstrumentationScopeCompatSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  forceFlush(): Promise<void> {
    return this.inner.forceFlush()
  }

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext)
  }

  onEnding(span: Span): void {
    this.inner.onEnding?.(span)
  }

  onEnd(span: ReadableSpan): void {
    this.inner.onEnd(normalizeReadableSpanInstrumentationScope(span))
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}

interface OtlpHttpExporterOptions {
  url: string
  headers?: Readonly<Record<string, string>>
}

const OtlpLogExporterCtor = OTLPLogExporter as new (options: {
  url: string
  headers?: Readonly<Record<string, string>>
}) => OTLPLogExporter
const BatchLogRecordProcessorCtor = BatchLogRecordProcessor as new (
  exporter: OTLPLogExporter
) => BatchLogRecordProcessor

const withOtlpHeaders = (
  url: string,
  headers: Readonly<Record<string, string>>
): OtlpHttpExporterOptions => {
  if (Object.keys(headers).length === 0) {
    return { url }
  }

  return {
    url,
    headers
  }
}

const makeTelemetryResourceFromEnv = (
  serviceName: string,
  env: ReturnType<typeof getObservabilityEnv>
): Resource =>
  resourceFromAttributes({
    ...env.OTEL_RESOURCE_ATTRIBUTES,
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: env.NODE_ENV
  })

const makeOtlpTraceSpanProcessorFromEnv = (
  env: ReturnType<typeof getObservabilityEnv>
): SpanProcessor =>
  new InstrumentationScopeCompatSpanProcessor(
    new BatchSpanProcessor(
      new OTLPTraceExporter(
        withOtlpHeaders(
          `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
          env.OTEL_EXPORTER_OTLP_HEADERS
        )
      )
    )
  )

export const makeTelemetryResource = (serviceName: string): Resource =>
  makeTelemetryResourceFromEnv(serviceName, getObservabilityEnv())

export const makeOtlpTraceSpanProcessor = (): SpanProcessor =>
  makeOtlpTraceSpanProcessorFromEnv(getObservabilityEnv())

export const startTelemetry = (serviceName: string): void => {
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
            new OtlpLogExporterCtor(
              withOtlpHeaders(
                `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs`,
                env.OTEL_EXPORTER_OTLP_HEADERS
              )
            )
          )
        ]

  const spanProcessors: SpanProcessor[] = [
    makeOtlpTraceSpanProcessorFromEnv(env)
  ]
  const langfuseSpanProcessor = createLangfuseSpanProcessor(env.LANGFUSE)
  if (langfuseSpanProcessor) {
    spanProcessors.push(langfuseSpanProcessor)
  }

  telemetrySdk = new NodeSDK({
    resource: makeTelemetryResourceFromEnv(serviceName, env),
    ...(logRecordProcessors ? { logRecordProcessors } : {}),
    spanProcessors,
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(
        withOtlpHeaders(
          `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`,
          env.OTEL_EXPORTER_OTLP_HEADERS
        )
      ),
      exportIntervalMillis: 5000
    })
  })

  telemetrySdk.start()
}

export const stopTelemetry = async (): Promise<void> => {
  if (!telemetrySdk) {
    return
  }

  const sdk = telemetrySdk
  telemetrySdk = undefined
  await sdk.shutdown()
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
