import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObservabilityEnv } from './env.js'
import { nodeServiceStartupMetricName } from './metrics-registry.js'

const diagSetLoggerMock = vi.fn()
const traceStartSpanMock = vi.fn(() => ({
  setAttribute: vi.fn(),
  end: vi.fn()
}))
const traceGetTracerMock = vi.fn(() => ({
  startSpan: traceStartSpanMock
}))
const metricsCounterAddMock = vi.fn()
const metricsCreateCounterMock = vi.fn(() => ({
  add: metricsCounterAddMock
}))
const metricsGetMeterMock = vi.fn(() => ({
  createCounter: metricsCreateCounterMock
}))
const sdkStartMock = vi.fn(() => Promise.resolve(undefined))
const sdkShutdownMock = vi.fn(() => Promise.resolve(undefined))
const nodeSdkConstructorMock = vi.fn(function MockNodeSDK(_options: unknown) {
  return {
    start: sdkStartMock,
    shutdown: sdkShutdownMock
  }
})
const otlpTraceExporterConstructorMock = vi.fn(function MockOTLPTraceExporter(options: unknown) {
  return { options }
})
const otlpLogExporterConstructorMock = vi.fn(function MockOTLPLogExporter(options: unknown) {
  return { options }
})
const otlpMetricExporterConstructorMock = vi.fn(function MockOTLPMetricExporter(options: unknown) {
  return { options }
})
const batchLogRecordProcessorConstructorMock = vi.fn(function MockBatchLogRecordProcessor(
  exporter: unknown
) {
  return { exporter }
})
const metricReaderConstructorMock = vi.fn(function MockMetricReader(options: unknown) {
  return { options }
})
const resourceFromAttributesMock = vi.fn((attributes: unknown) => attributes)
const langfuseSpanProcessorConstructorMock = vi.fn(function MockLangfuseSpanProcessor(
  options: unknown
) {
  return { options }
})
const isDefaultExportSpanMock = vi.fn(() => true)

const getObservabilityEnvMock = vi.fn<() => ObservabilityEnv>(() => ({
  OTEL_LOG_LEVEL: 'debug',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel.example:4318',
  OTEL_LOGS_EXPORTER: 'otlp',
  NODE_ENV: 'staging',
  LANGFUSE: {
    enabled: false,
    baseUrl: 'http://localhost:3003',
    publicKey: '',
    secretKey: '',
    sampleRate: 1,
    logLevel: 'WARN',
    environment: 'staging',
    release: undefined
  }
}))

interface LangfuseProcessorOptionsForTest {
  publicKey: string
  secretKey: string
  baseUrl: string
  environment: string
  release?: string
  mask: unknown
  shouldExportSpan: unknown
}

interface NodeSdkOptionsForTest {
  spanProcessors?: readonly unknown[]
}

const batchSpanProcessorConstructorMock = vi.fn(function MockBatchSpanProcessor(
  exporter: unknown
) {
  return { exporter }
})

vi.mock('@opentelemetry/api', () => ({
  diag: {
    setLogger: diagSetLoggerMock
  },
  trace: {
    getTracer: traceGetTracerMock
  },
  metrics: {
    getMeter: metricsGetMeterMock
  },
  DiagConsoleLogger: class MockDiagConsoleLogger { readonly _mock = true },
  DiagLogLevel: {
    DEBUG: 'DEBUG'
  }
}))

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: otlpTraceExporterConstructorMock
}))

vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: otlpLogExporterConstructorMock
}))

vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: otlpMetricExporterConstructorMock
}))

vi.mock('@opentelemetry/sdk-logs', () => ({
  BatchLogRecordProcessor: batchLogRecordProcessorConstructorMock
}))

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: resourceFromAttributesMock
}))

vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: metricReaderConstructorMock
}))

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: nodeSdkConstructorMock
}))

vi.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: batchSpanProcessorConstructorMock
}))

vi.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: langfuseSpanProcessorConstructorMock,
  isDefaultExportSpan: isDefaultExportSpanMock
}))

vi.mock('./env.js', () => ({
  getObservabilityEnv: getObservabilityEnvMock
}))

describe('telemetry lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('starts OpenTelemetry with expected OTLP endpoints and service metadata', async () => {
    const telemetryModule = await import('./index.js')

    telemetryModule.startTelemetry('tx-agent-kit-test-service')

    expect(diagSetLoggerMock).toHaveBeenCalledTimes(1)
    expect(getObservabilityEnvMock).toHaveBeenCalledTimes(1)

    expect(otlpTraceExporterConstructorMock).toHaveBeenCalledWith({
      url: 'http://otel.example:4318/v1/traces'
    })

    expect(otlpLogExporterConstructorMock).toHaveBeenCalledWith({
      url: 'http://otel.example:4318/v1/logs'
    })

    expect(batchLogRecordProcessorConstructorMock).toHaveBeenCalledTimes(1)

    expect(otlpMetricExporterConstructorMock).toHaveBeenCalledWith({
      url: 'http://otel.example:4318/v1/metrics'
    })

    expect(metricReaderConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        exportIntervalMillis: 5000
      })
    )

    expect(resourceFromAttributesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        'service.name': 'tx-agent-kit-test-service',
        'deployment.environment.name': 'staging'
      })
    )

    expect(nodeSdkConstructorMock).toHaveBeenCalledTimes(1)
    expect(langfuseSpanProcessorConstructorMock).not.toHaveBeenCalled()
    expect(sdkStartMock).toHaveBeenCalledTimes(1)

    await telemetryModule.stopTelemetry()
    expect(sdkShutdownMock).toHaveBeenCalledTimes(1)
  })

  it('is idempotent on repeated start and can restart after stop', async () => {
    const telemetryModule = await import('./index.js')

    telemetryModule.startTelemetry('tx-agent-kit-test-service')
    telemetryModule.startTelemetry('tx-agent-kit-test-service')

    expect(nodeSdkConstructorMock).toHaveBeenCalledTimes(1)
    expect(sdkStartMock).toHaveBeenCalledTimes(1)

    await telemetryModule.stopTelemetry()
    expect(sdkShutdownMock).toHaveBeenCalledTimes(1)

    telemetryModule.startTelemetry('tx-agent-kit-test-service')
    expect(nodeSdkConstructorMock).toHaveBeenCalledTimes(2)
    expect(sdkStartMock).toHaveBeenCalledTimes(2)

    await telemetryModule.stopTelemetry()
    expect(sdkShutdownMock).toHaveBeenCalledTimes(2)
  })

  it('skips OTLP log processor wiring when OTEL_LOGS_EXPORTER is set to none', async () => {
    getObservabilityEnvMock.mockReturnValueOnce({
      OTEL_LOG_LEVEL: 'info',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel.example:4318',
      OTEL_LOGS_EXPORTER: 'none',
      NODE_ENV: 'staging',
      LANGFUSE: {
        enabled: false,
        baseUrl: 'http://localhost:3003',
        publicKey: '',
        secretKey: '',
        sampleRate: 1,
        logLevel: 'WARN',
        environment: 'staging',
        release: undefined
      }
    })

    const telemetryModule = await import('./index.js')

    telemetryModule.startTelemetry('tx-agent-kit-test-service')

    expect(otlpLogExporterConstructorMock).not.toHaveBeenCalled()
    expect(batchLogRecordProcessorConstructorMock).not.toHaveBeenCalled()

    await telemetryModule.stopTelemetry()
  })

  it('adds a Langfuse span processor when Langfuse export is enabled', async () => {
    getObservabilityEnvMock.mockReturnValueOnce({
      OTEL_LOG_LEVEL: 'info',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel.example:4318',
      OTEL_LOGS_EXPORTER: 'none',
      NODE_ENV: 'staging',
      LANGFUSE: {
        enabled: true,
        baseUrl: 'https://us.cloud.langfuse.com',
        publicKey: 'pk-lf-test',
        secretKey: 'sk-lf-test',
        sampleRate: 1,
        logLevel: 'WARN',
        environment: 'staging',
        release: 'sha-123'
      }
    })

    const telemetryModule = await import('./index.js')

    telemetryModule.startTelemetry('tx-agent-kit-test-service')

    const langfuseOptions =
      langfuseSpanProcessorConstructorMock.mock.calls[0]?.[0] as
        | LangfuseProcessorOptionsForTest
        | undefined
    expect(langfuseOptions).toMatchObject({
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
      baseUrl: 'https://us.cloud.langfuse.com',
      environment: 'staging',
      release: 'sha-123'
    })
    expect(langfuseOptions?.mask).toEqual(expect.any(Function))
    expect(langfuseOptions?.shouldExportSpan).toEqual(expect.any(Function))

    const nodeSdkOptions = nodeSdkConstructorMock.mock.calls[0]?.[0] as
      | NodeSdkOptionsForTest
      | undefined
    expect(nodeSdkOptions?.spanProcessors).toHaveLength(2)

    await telemetryModule.stopTelemetry()
  })

  it('emits a smoke span and counter using global tracer and meter', async () => {
    const telemetryModule = await import('./index.js')

    telemetryModule.emitNodeTelemetrySmoke('tx-agent-kit-smoke')

    expect(traceGetTracerMock).toHaveBeenCalledWith('tx-agent-kit-smoke')
    expect(traceStartSpanMock).toHaveBeenCalledWith('observability.smoke.node')
    expect(metricsGetMeterMock).toHaveBeenCalledWith('tx-agent-kit-smoke')
    expect(metricsCreateCounterMock).toHaveBeenCalledWith(
      nodeServiceStartupMetricName,
      expect.objectContaining({
        unit: '{startup}'
      })
    )
    expect(metricsCounterAddMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        'smoke.service': 'tx-agent-kit-smoke'
      })
    )
  })
})
