const appJson = require('./app.json')

const defaultApiBaseUrl = 'http://localhost:4000'
const defaultOtelEndpoint = 'http://localhost:4320'
const defaultNodeEnv = 'development'

module.exports = () => {
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    defaultApiBaseUrl

  const otelEndpoint =
    process.env.EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    defaultOtelEndpoint

  const nodeEnv =
    process.env.EXPO_PUBLIC_NODE_ENV ??
    process.env.NODE_ENV ??
    defaultNodeEnv

  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? ''

  return {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra ?? {}),
      API_BASE_URL: apiBaseUrl,
      OTEL_EXPORTER_OTLP_ENDPOINT: otelEndpoint,
      NODE_ENV: nodeEnv,
      SENTRY_DSN: sentryDsn
    }
  }
}
