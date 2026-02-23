import { beforeEach, describe, expect, it, vi } from 'vitest'

const setGlobalTracerProviderMock = vi.fn()
const smokeSetAttributeMock = vi.fn()
const smokeSpanEndMock = vi.fn()
const tracerStartSpanMock = vi.fn(() => ({
  setAttribute: smokeSetAttributeMock,
  end: smokeSpanEndMock
}))
const getTracerMock = vi.fn(() => ({ startSpan: tracerStartSpanMock }))
const setGlobalMeterProviderMock = vi.fn()

const traceExporterConstructorMock = vi.fn(function MockTraceExporter(options: unknown) {
  return { options }
})
const metricExporterConstructorMock = vi.fn(function MockMetricExporter(options: unknown) {
  return { options }
})
const resourceFromAttributesMock = vi.fn((attributes: unknown) => attributes)
const batchSpanProcessorConstructorMock = vi.fn(function MockBatchSpanProcessor(exporter: unknown) {
  return { exporter }
})
const tracerProviderShutdownMock = vi.fn(() => Promise.resolve(undefined))
const tracerProviderConstructorMock = vi.fn(function MockTracerProvider() {
  return { shutdown: tracerProviderShutdownMock }
})
const metricReaderConstructorMock = vi.fn(function MockMetricReader(options: unknown) {
  return { options }
})
const counterAddMock = vi.fn()
const histogramRecordMock = vi.fn()
const meterCreateCounterMock = vi.fn(() => ({
  add: counterAddMock
}))
const meterCreateHistogramMock = vi.fn(() => ({
  record: histogramRecordMock
}))
const meterProviderShutdownMock = vi.fn(() => Promise.resolve(undefined))
const meterProviderGetMeterMock = vi.fn(() => ({
  createCounter: meterCreateCounterMock,
  createHistogram: meterCreateHistogramMock
}))
const meterProviderConstructorMock = vi.fn(function MockMeterProvider() {
  return {
    shutdown: meterProviderShutdownMock,
    getMeter: meterProviderGetMeterMock
  }
})

vi.mock('@opentelemetry/api', () => ({
  trace: {
    setGlobalTracerProvider: setGlobalTracerProviderMock,
    getTracer: getTracerMock
  },
  metrics: {
    setGlobalMeterProvider: setGlobalMeterProviderMock
  }
}))

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: traceExporterConstructorMock
}))

vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: metricExporterConstructorMock
}))

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: resourceFromAttributesMock
}))

vi.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: batchSpanProcessorConstructorMock,
  BasicTracerProvider: tracerProviderConstructorMock
}))

vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: metricReaderConstructorMock,
  MeterProvider: meterProviderConstructorMock
}))

describe('client telemetry lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    delete process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT
    delete process.env.EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  })

  it('configures client telemetry with explicit OTLP endpoint and records request metrics', async () => {
    const module = await import('./client.js')
    const telemetry = module.getClientHttpTelemetry({
      serviceName: 'tx-agent-kit-web',
      otlpEndpoint: 'https://otel.example'
    })

    telemetry.recordRequest(123, {
      'http.request.method': 'GET',
      'url.path': '/v1/tasks'
    })

    expect(resourceFromAttributesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        'service.name': 'tx-agent-kit-web'
      })
    )

    expect(traceExporterConstructorMock).toHaveBeenCalledWith({
      url: 'https://otel.example/v1/traces'
    })

    expect(metricExporterConstructorMock).toHaveBeenCalledWith({
      url: 'https://otel.example/v1/metrics'
    })

    expect(counterAddMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        'http.request.method': 'GET'
      })
    )
    expect(histogramRecordMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        'url.path': '/v1/tasks'
      })
    )

    await module.stopClientTelemetry()
    expect(tracerProviderShutdownMock).toHaveBeenCalledTimes(1)
    expect(meterProviderShutdownMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to NEXT_PUBLIC OTLP endpoint and initializes only once', async () => {
    process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.local:4320'

    const module = await import('./client.js')
    module.getClientHttpTelemetry({ serviceName: 'tx-agent-kit-web' })
    module.getClientHttpTelemetry({ serviceName: 'tx-agent-kit-web' })

    expect(traceExporterConstructorMock).toHaveBeenCalledTimes(1)
    expect(metricExporterConstructorMock).toHaveBeenCalledTimes(1)
    expect(traceExporterConstructorMock).toHaveBeenCalledWith({
      url: 'http://collector.local:4320/v1/traces'
    })
    expect(metricExporterConstructorMock).toHaveBeenCalledWith({
      url: 'http://collector.local:4320/v1/metrics'
    })

    await module.stopClientTelemetry()
  })

  it('reinitializes telemetry when service configuration changes', async () => {
    process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.local:4320'

    const module = await import('./client.js')

    module.getClientHttpTelemetry({ serviceName: 'tx-agent-kit-web' })
    module.getClientHttpTelemetry({ serviceName: 'tx-agent-kit-mobile' })

    expect(traceExporterConstructorMock).toHaveBeenCalledTimes(2)
    expect(metricExporterConstructorMock).toHaveBeenCalledTimes(2)
    expect(tracerProviderShutdownMock).toHaveBeenCalledTimes(1)
    expect(meterProviderShutdownMock).toHaveBeenCalledTimes(1)

    await module.stopClientTelemetry()
  })

  it('emits smoke client telemetry span and request metric', async () => {
    const module = await import('./client.js')

    module.emitClientTelemetrySmoke({
      serviceName: 'tx-agent-kit-mobile',
      otlpEndpoint: 'https://otel.example'
    })

    expect(tracerStartSpanMock).toHaveBeenCalledWith('observability.smoke.client')
    expect(smokeSetAttributeMock).toHaveBeenCalledWith(
      'smoke.service',
      'tx-agent-kit-mobile'
    )
    expect(smokeSpanEndMock).toHaveBeenCalledTimes(1)
    expect(counterAddMock).toHaveBeenCalled()
    expect(histogramRecordMock).toHaveBeenCalled()

    await module.stopClientTelemetry()
  })
})
