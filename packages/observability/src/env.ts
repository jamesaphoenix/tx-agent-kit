const defaultOtelEndpoint = 'http://localhost:4318'
const defaultNodeEnv = 'development'

export interface ObservabilityEnv {
  OTEL_LOG_LEVEL: string | undefined
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
