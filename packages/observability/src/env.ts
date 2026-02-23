const defaultOtelEndpoint = 'http://localhost:4318'
const defaultClientOtelEndpoint = 'http://localhost:4320'
const defaultNodeEnv = 'development'

export interface ObservabilityEnv {
  OTEL_LOG_LEVEL: string | undefined
  OTEL_EXPORTER_OTLP_ENDPOINT: string
  NODE_ENV: string
}

export interface ClientObservabilityEnv {
  OTEL_EXPORTER_OTLP_ENDPOINT: string
  NODE_ENV: string
}

export const getObservabilityEnv = (): ObservabilityEnv => {
  return {
    OTEL_LOG_LEVEL: process.env.OTEL_LOG_LEVEL,
    OTEL_EXPORTER_OTLP_ENDPOINT:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? defaultOtelEndpoint,
    NODE_ENV: process.env.NODE_ENV ?? defaultNodeEnv
  }
}

export const getClientObservabilityEnv = (): ClientObservabilityEnv => {
  return {
    OTEL_EXPORTER_OTLP_ENDPOINT:
      process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
      process.env.EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      defaultClientOtelEndpoint,
    NODE_ENV:
      process.env.NEXT_PUBLIC_NODE_ENV ??
      process.env.EXPO_PUBLIC_NODE_ENV ??
      process.env.NODE_ENV ??
      defaultNodeEnv
  }
}
