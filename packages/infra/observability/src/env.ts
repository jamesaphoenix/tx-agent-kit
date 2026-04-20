const defaultOtelEndpoint = 'http://localhost:4320'
const defaultClientOtelEndpoint = 'http://localhost:4320'
const defaultLangfuseBaseUrl = 'http://localhost:3003'
const defaultNodeEnv = 'development'
const defaultLangfuseSampleRate = 1

const allowedLangfuseLogLevels = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR'])

export interface LangfuseEnv {
  enabled: boolean
  baseUrl: string
  publicKey: string
  secretKey: string
  sampleRate: number
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  environment: string
  release: string | undefined
}

export interface ObservabilityEnv {
  OTEL_LOG_LEVEL: string | undefined
  OTEL_EXPORTER_OTLP_ENDPOINT: string
  OTEL_LOGS_EXPORTER: 'otlp' | 'none'
  NODE_ENV: string
  LANGFUSE: LangfuseEnv
}

export interface ClientObservabilityEnv {
  OTEL_EXPORTER_OTLP_ENDPOINT: string
  NODE_ENV: string
}

const isTruthy = (value: string | undefined): boolean =>
  value === '1' || value?.toLowerCase() === 'true'

const parseLangfuseSampleRate = (): number => {
  const raw = process.env.LANGFUSE_SAMPLE_RATE
  if (raw === undefined || raw.length === 0) {
    return defaultLangfuseSampleRate
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('LANGFUSE_SAMPLE_RATE must be a number between 0 and 1')
  }

  return parsed
}

const parseLangfuseLogLevel = (): LangfuseEnv['logLevel'] => {
  const raw = process.env.LANGFUSE_LOG_LEVEL?.toUpperCase()
  if (raw === undefined || raw.length === 0) {
    return 'WARN'
  }

  if (!allowedLangfuseLogLevels.has(raw)) {
    throw new Error('LANGFUSE_LOG_LEVEL must be one of DEBUG, INFO, WARN, ERROR')
  }

  return raw as LangfuseEnv['logLevel']
}

const getLangfuseEnv = (nodeEnv: string): LangfuseEnv => {
  const enabled = isTruthy(process.env.LANGFUSE_ENABLED)
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? ''
  const secretKey = process.env.LANGFUSE_SECRET_KEY ?? ''
  const baseUrl =
    process.env.LANGFUSE_BASE_URL ??
    process.env.LANGFUSE_HOST ??
    defaultLangfuseBaseUrl

  if (enabled) {
    const missing = [
      publicKey.length === 0 ? 'LANGFUSE_PUBLIC_KEY' : undefined,
      secretKey.length === 0 ? 'LANGFUSE_SECRET_KEY' : undefined
    ].filter((key): key is string => key !== undefined)

    if (missing.length > 0) {
      throw new Error(
        `LANGFUSE_ENABLED=true requires ${missing.join(', ')} to be configured`
      )
    }
  }

  return {
    enabled,
    baseUrl,
    publicKey,
    secretKey,
    sampleRate: parseLangfuseSampleRate(),
    logLevel: parseLangfuseLogLevel(),
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? nodeEnv,
    release: process.env.LANGFUSE_RELEASE
  }
}

export const getObservabilityEnv = (): ObservabilityEnv => {
  const logLevel = process.env.OTEL_LOG_LEVEL?.toLowerCase()
  const logsExporter = process.env.OTEL_LOGS_EXPORTER?.toLowerCase()
  const nodeEnv = process.env.NODE_ENV ?? defaultNodeEnv

  return {
    OTEL_LOG_LEVEL: logLevel,
    OTEL_EXPORTER_OTLP_ENDPOINT:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? defaultOtelEndpoint,
    OTEL_LOGS_EXPORTER: logsExporter === 'none' ? 'none' : 'otlp',
    NODE_ENV: nodeEnv,
    LANGFUSE: getLangfuseEnv(nodeEnv)
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
