import Constants from 'expo-constants'

const defaultApiBaseUrl = 'http://localhost:4000'
const defaultOtelEndpoint = 'http://localhost:4320'
const defaultNodeEnv = 'development'

export interface MobileEnv {
  API_BASE_URL: string
  OTEL_EXPORTER_OTLP_ENDPOINT: string
  NODE_ENV: string
}

let cachedEnv: MobileEnv | null = null

export const getMobileEnv = (): MobileEnv => {
  if (cachedEnv) {
    return cachedEnv
  }

  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined

  cachedEnv = {
    API_BASE_URL:
      (typeof extra?.API_BASE_URL === 'string' ? extra.API_BASE_URL : null) ?? defaultApiBaseUrl,
    OTEL_EXPORTER_OTLP_ENDPOINT:
      (typeof extra?.OTEL_EXPORTER_OTLP_ENDPOINT === 'string'
        ? extra.OTEL_EXPORTER_OTLP_ENDPOINT
        : null) ?? defaultOtelEndpoint,
    NODE_ENV:
      (typeof extra?.NODE_ENV === 'string' ? extra.NODE_ENV : null) ?? defaultNodeEnv
  }

  return cachedEnv
}

export const _resetEnvCacheForTest = (): void => {
  cachedEnv = null
}
