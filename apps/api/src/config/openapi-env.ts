const defaultOpenApiServerUrl = 'http://localhost:4000'

export interface OpenApiEnv {
  OPENAPI_SERVER_URL: string
}

export const getOpenApiEnv = (): OpenApiEnv => {
  return {
    OPENAPI_SERVER_URL:
      process.env.OPENAPI_SERVER_URL ?? defaultOpenApiServerUrl
  }
}
