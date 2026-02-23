import {
  emitNodeTelemetrySmoke,
  startTelemetry,
  stopTelemetry
} from '@tx-agent-kit/observability'
import {
  emitClientTelemetrySmoke,
  stopClientTelemetry
} from '@tx-agent-kit/observability/client'

const defaultOtelEndpoint = 'http://localhost:4320'
const nodeServiceNames = ['tx-agent-kit-api', 'tx-agent-kit-worker'] as const
const clientServiceNames = ['tx-agent-kit-web', 'tx-agent-kit-mobile'] as const

const resolveOtelEndpoint = (): string =>
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
  process.env.EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
  defaultOtelEndpoint

const emitNodeSmokeSignals = async (
  otlpEndpoint: string,
  serviceName: string
): Promise<void> => {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = otlpEndpoint

  await startTelemetry(serviceName)
  emitNodeTelemetrySmoke(serviceName)
  await stopTelemetry()
}

const emitClientSmokeSignals = async (
  otlpEndpoint: string,
  serviceName: string
): Promise<void> => {
  emitClientTelemetrySmoke({
    serviceName,
    otlpEndpoint,
    deploymentEnvironment: 'test'
  })

  await stopClientTelemetry()
}

const emitNodeSmokeSignalsForServices = async (
  otlpEndpoint: string,
  selectedServices: ReadonlyArray<string>
): Promise<void> => {
  for (const serviceName of selectedServices) {
    await emitNodeSmokeSignals(otlpEndpoint, serviceName)
  }
}

const emitClientSmokeSignalsForServices = async (
  otlpEndpoint: string,
  selectedServices: ReadonlyArray<string>
): Promise<void> => {
  for (const serviceName of selectedServices) {
    await emitClientSmokeSignals(otlpEndpoint, serviceName)
  }
}

const main = async (): Promise<void> => {
  const otlpEndpoint = resolveOtelEndpoint()
  const mode = (process.argv[2] ?? 'all').toLowerCase()
  const requestedService = process.argv[3]
  const selectedNodeServices =
    requestedService === undefined ? [...nodeServiceNames] : [requestedService]
  const selectedClientServices =
    requestedService === undefined ? [...clientServiceNames] : [requestedService]

  if (mode === 'all' || mode === 'node') {
    await emitNodeSmokeSignalsForServices(otlpEndpoint, selectedNodeServices)
  }

  if (mode === 'all' || mode === 'client') {
    await emitClientSmokeSignalsForServices(otlpEndpoint, selectedClientServices)
  }
}

void main()
