import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const nodeSdkConstructorMock = vi.fn(function MockNodeSDK() {
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

const getObservabilityEnvMock = vi.fn(() => ({
  OTEL_LOG_LEVEL: 'debug',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel.example:4318',
  OTEL_LOGS_EXPORTER: 'otlp',
  NODE_ENV: 'staging'
}))

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
  DiagConsoleLogger: class MockDiagConsoleLogger {},
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

    await telemetryModule.startTelemetry('tx-agent-kit-test-service')

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
        'deployment.environment': 'staging'
      })
    )

    expect(nodeSdkConstructorMock).toHaveBeenCalledTimes(1)
    expect(sdkStartMock).toHaveBeenCalledTimes(1)

    await telemetryModule.stopTelemetry()
    expect(sdkShutdownMock).toHaveBeenCalledTimes(1)
  })

  it('is idempotent on repeated start and can restart after stop', async () => {
    const telemetryModule = await import('./index.js')

    await telemetryModule.startTelemetry('tx-agent-kit-test-service')
    await telemetryModule.startTelemetry('tx-agent-kit-test-service')

    expect(nodeSdkConstructorMock).toHaveBeenCalledTimes(1)
    expect(sdkStartMock).toHaveBeenCalledTimes(1)

    await telemetryModule.stopTelemetry()
    expect(sdkShutdownMock).toHaveBeenCalledTimes(1)

    await telemetryModule.startTelemetry('tx-agent-kit-test-service')
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
      NODE_ENV: 'staging'
    })

    const telemetryModule = await import('./index.js')

    await telemetryModule.startTelemetry('tx-agent-kit-test-service')

    expect(otlpLogExporterConstructorMock).not.toHaveBeenCalled()
    expect(batchLogRecordProcessorConstructorMock).not.toHaveBeenCalled()

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
