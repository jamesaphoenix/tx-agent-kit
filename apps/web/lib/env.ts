const productionLikeNodeEnvs = new Set(['production', 'staging', 'preview'])

const isProductionLikeRuntime = (): boolean => {
  const explicit =
    [process.env.NEXT_PUBLIC_NODE_ENV, process.env.NODE_ENV]
      .find((value) => typeof value === 'string' && value.trim().length > 0) ?? ''
  return productionLikeNodeEnvs.has(explicit.trim().toLowerCase())
}

const resolveDefault = (devValue: string): string =>
  isProductionLikeRuntime() ? '' : devValue

const defaultApiBaseUrl = resolveDefault('http://localhost:4000')
const defaultOtelEndpoint = resolveDefault('http://localhost:4320')

export interface WebEnv {
  API_BASE_URL: string
  OTEL_EXPORTER_OTLP_ENDPOINT: string
  NODE_ENV: string
  SITE_URL: string
  SENTRY_DSN: string | undefined
  SENTRY_SPOTLIGHT: boolean
  STRIPE_PUBLISHABLE_KEY: string | undefined
  TURNSTILE_SITE_KEY: string | undefined
}

let cachedEnv: WebEnv | null = null

/** Reset cached env — used by integration test setup to apply test-specific env vars. */
export const resetWebEnvCache = (): void => { cachedEnv = null }

const parseOptionalString = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue.length > 0 ? normalizedValue : undefined
}

export const shouldRenderDeveloperTools = (nodeEnv: string): boolean => {
  const normalizedNodeEnv = nodeEnv.trim().toLowerCase()
  return !productionLikeNodeEnvs.has(normalizedNodeEnv)
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
      parseOptionalString(process.env.NEXT_PUBLIC_NODE_ENV) ??
      parseOptionalString(process.env.NODE_ENV) ??
      'development',
    SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL ??
      'http://localhost:3000',
    SENTRY_DSN: parseOptionalString(process.env.NEXT_PUBLIC_SENTRY_DSN),
    STRIPE_PUBLISHABLE_KEY: parseOptionalString(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
    TURNSTILE_SITE_KEY: parseOptionalString(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
    SENTRY_SPOTLIGHT:
      (process.env.NEXT_PUBLIC_SENTRY_SPOTLIGHT ?? process.env.SENTRY_SPOTLIGHT ?? '')
        .trim()
        .toLowerCase() === 'true'
  }

  return cachedEnv
}
