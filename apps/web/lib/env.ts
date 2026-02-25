const defaultApiBaseUrl = 'http://localhost:4000'
const defaultOtelEndpoint = 'http://localhost:4320'
const defaultNodeEnv = 'development'

export interface WebEnv {
  API_BASE_URL: string
  OTEL_EXPORTER_OTLP_ENDPOINT: string
  NODE_ENV: string
  SITE_URL: string
  SENTRY_DSN: string | undefined
}

let cachedEnv: WebEnv | null = null

const parseOptionalString = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue.length > 0 ? normalizedValue : undefined
}

export const getWebEnv = (): WebEnv => {
  if (cachedEnv) {
    return cachedEnv
  }

  cachedEnv = {
    API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      process.env.API_BASE_URL ??
      defaultApiBaseUrl,
    OTEL_EXPORTER_OTLP_ENDPOINT:
      process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      defaultOtelEndpoint,
    NODE_ENV:
      process.env.NEXT_PUBLIC_NODE_ENV ??
      process.env.NODE_ENV ??
      defaultNodeEnv,
    SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL ??
      'http://localhost:3000',
    SENTRY_DSN: parseOptionalString(process.env.NEXT_PUBLIC_SENTRY_DSN)
  }

  return cachedEnv
}
