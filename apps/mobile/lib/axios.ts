import { getClientHttpTelemetry } from '@tx-agent-kit/observability/client'
import type { AuthResponse } from '@tx-agent-kit/contracts'
import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig
} from 'axios'
import {
  clearAuthToken,
  clearRefreshToken,
  readAuthToken,
  readRefreshToken,
  writeAuthToken,
  writeRefreshToken
} from './auth-token'
import { getMobileEnv } from './env'

const mobileEnv = getMobileEnv()
const mobileClientTelemetry = getClientHttpTelemetry({
  serviceName: 'tx-agent-kit-mobile',
  otlpEndpoint: mobileEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
  deploymentEnvironment: mobileEnv.NODE_ENV
})

interface ApiErrorPayload {
  message?: string
  error?: {
    message?: string
  }
}

interface RequestTelemetryContext {
  readonly span: ReturnType<typeof mobileClientTelemetry.tracer.startSpan>
  readonly startedAtMs: number
  readonly method: string
  readonly path: string
}

interface ApiRequestConfig extends InternalAxiosRequestConfig {
  _retryAuthRefresh?: boolean
  _skipAuthRefresh?: boolean
}

const spanStatusCode = {
  OK: 1,
  ERROR: 2
} as const

const requestTelemetryContexts = new WeakMap<
  InternalAxiosRequestConfig,
  RequestTelemetryContext
>()

const nowMs = (): number => {
  if (typeof globalThis.performance !== 'undefined') {
    return globalThis.performance.now()
  }

  return Date.now()
}

const normalizeHttpMethod = (method: string | undefined): string =>
  (method ?? 'GET').toUpperCase()

const resolveRequestPath = (config: InternalAxiosRequestConfig): string => {
  const requestUrl = config.url ?? '/'

  try {
    const resolvedUrl = new URL(requestUrl, config.baseURL ?? mobileEnv.API_BASE_URL)
    return resolvedUrl.pathname
  } catch {
    return requestUrl
  }
}

const startRequestTelemetry = (
  config: InternalAxiosRequestConfig
): InternalAxiosRequestConfig => {
  const method = normalizeHttpMethod(config.method)
  const path = resolveRequestPath(config)
  const span = mobileClientTelemetry.tracer.startSpan('http.client.request', {
    attributes: {
      'http.request.method': method,
      'url.path': path
    }
  })

  requestTelemetryContexts.set(config, {
    span,
    startedAtMs: nowMs(),
    method,
    path
  })

  return config
}

const finishRequestTelemetry = (
  config: InternalAxiosRequestConfig,
  statusCode: number | undefined,
  error: Error | undefined
): void => {
  const telemetryContext = requestTelemetryContexts.get(config)
  if (!telemetryContext) {
    return
  }

  requestTelemetryContexts.delete(config)
  const durationMs = Math.max(nowMs() - telemetryContext.startedAtMs, 0)
  const responseStatus = statusCode ?? 0

  if (statusCode !== undefined) {
    telemetryContext.span.setAttribute('http.response.status_code', statusCode)
  }

  mobileClientTelemetry.recordRequest(durationMs, {
    'http.request.method': telemetryContext.method,
    'url.path': telemetryContext.path,
    'http.response.status_code': responseStatus
  })

  if (error) {
    telemetryContext.span.recordException(error)
    telemetryContext.span.setStatus({
      code: spanStatusCode.ERROR,
      message: error.message
    })
  } else if (responseStatus >= 400) {
    telemetryContext.span.setStatus({
      code: spanStatusCode.ERROR,
      message: `HTTP ${responseStatus}`
    })
  } else {
    telemetryContext.span.setStatus({
      code: spanStatusCode.OK
    })
  }

  telemetryContext.span.end()
}

const isApiErrorPayload = (value: unknown): value is ApiErrorPayload => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>
  return typeof obj['message'] === 'string' || (typeof obj['error'] === 'object' && obj['error'] !== null)
}

const attachAuthHeader = async (
  config: InternalAxiosRequestConfig
): Promise<InternalAxiosRequestConfig> => {
  const token = await readAuthToken()
  const hasExplicitAuthorizationHeader =
    config.headers.Authorization !== undefined && config.headers.Authorization !== null

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  } else if (!hasExplicitAuthorizationHeader) {
    delete config.headers.Authorization
  }

  return startRequestTelemetry(config)
}

const authRefreshExcludedPaths = new Set([
  '/v1/auth/sign-in',
  '/v1/auth/sign-up',
  '/v1/auth/refresh'
])

let refreshAccessTokenPromise: Promise<void> | null = null

const refreshApi = axios.create({
  baseURL: mobileEnv.API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

export const refreshAccessToken = async (): Promise<void> => {
  if (refreshAccessTokenPromise !== null) {
    return refreshAccessTokenPromise
  }

  refreshAccessTokenPromise = (async () => {
    try {
      const refreshToken = await readRefreshToken()
      if (!refreshToken) {
        throw new Error('No refresh token is available')
      }

      const { data } = await refreshApi.post<AuthResponse>('/v1/auth/refresh', {
        refreshToken
      })

      await writeAuthToken(data.token)

      if (typeof data.refreshToken === 'string' && data.refreshToken.length > 0) {
        await writeRefreshToken(data.refreshToken)
      }
    } finally {
      refreshAccessTokenPromise = null
    }
  })()

  return refreshAccessTokenPromise
}

const shouldRetryWithRefresh = async (
  config: ApiRequestConfig,
  statusCode: number | undefined
): Promise<boolean> => {
  if (statusCode !== 401) {
    return false
  }

  if (config._retryAuthRefresh || config._skipAuthRefresh) {
    return false
  }

  const path = resolveRequestPath(config)
  if (authRefreshExcludedPaths.has(path)) {
    return false
  }

  const refreshToken = await readRefreshToken()
  return typeof refreshToken === 'string' && refreshToken.length > 0
}

export const api = axios.create({
  baseURL: mobileEnv.API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

api.interceptors.request.use(attachAuthHeader)
api.interceptors.response.use(
  (response) => {
    finishRequestTelemetry(response.config, response.status, undefined)
    return response
  },
  async (error: unknown) => {
    if (axios.isAxiosError(error) && error.config) {
      const config = error.config as ApiRequestConfig
      const statusCode = error.response?.status

      if (await shouldRetryWithRefresh(config, statusCode)) {
        finishRequestTelemetry(config, statusCode, error)

        try {
          await refreshAccessToken()
          config._retryAuthRefresh = true
          return await api(config)
        } catch (catchError) {
          const catchStatus = getApiErrorStatus(catchError)
          if (catchStatus === 401 || catchStatus === 403) {
            await clearAuthToken()
            await clearRefreshToken()
          }
          throw catchError
        }
      } else {
        finishRequestTelemetry(config, statusCode, error)
      }
    }

    throw error instanceof Error ? error : new Error('Mobile API client request failed.')
  }
)

export const getApiErrorStatus = (error: unknown): number | undefined => {
  if (!axios.isAxiosError(error)) {
    return undefined
  }

  return error.response?.status
}

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (!axios.isAxiosError(error)) {
    return fallback
  }

  const payload: unknown = error.response?.data
  if (!isApiErrorPayload(payload)) {
    return error.message || fallback
  }

  return payload.error?.message ?? payload.message ?? error.message
}

export type ApiAxiosRequestConfig = AxiosRequestConfig
export type ApiAxiosError<T = unknown> = AxiosError<T>
