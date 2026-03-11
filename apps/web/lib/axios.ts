import { getClientHttpTelemetry } from '@tx-agent-kit/observability/client'
import type { AuthResponse } from '@tx-agent-kit/contracts'
import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig
} from 'axios'
import {
  clearAuthToken,
  readAuthToken,
  withSerializedAuthRefresh,
  writeAuthToken
} from './auth-token'
import { browserAuthSessionHeaders } from './auth-session-mode'
import { getWebEnv } from './env'

const webEnv = getWebEnv()
const webClientTelemetry = getClientHttpTelemetry({
  serviceName: 'tx-agent-kit-web',
  otlpEndpoint: webEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
  deploymentEnvironment: webEnv.NODE_ENV
})

interface ApiErrorPayload {
  message?: string
  error?: {
    message?: string
  }
}

interface RequestTelemetryContext {
  readonly span: ReturnType<typeof webClientTelemetry.tracer.startSpan>
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
    const resolvedUrl = new URL(requestUrl, config.baseURL ?? webEnv.API_BASE_URL)
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
  const span = webClientTelemetry.tracer.startSpan('http.client.request', {
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

  webClientTelemetry.recordRequest(durationMs, {
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

  return true
}

const attachAuthHeader = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  const requestConfig = config as ApiRequestConfig
  const token = readAuthToken()
  const hasExplicitAuthorizationHeader =
    config.headers.Authorization !== undefined && config.headers.Authorization !== null

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  } else if (!hasExplicitAuthorizationHeader) {
    delete config.headers.Authorization
  }

  return startRequestTelemetry(requestConfig)
}

const authRefreshExcludedPaths = new Set([
  '/v1/auth/sign-in',
  '/v1/auth/sign-up',
  '/v1/auth/refresh',
  '/v1/auth/forgot-password',
  '/v1/auth/reset-password',
  '/v1/auth/google/start',
  '/v1/auth/google/callback'
])

let refreshAccessTokenPromise: Promise<void> | null = null

const refreshApi = axios.create({
  baseURL: webEnv.API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    ...browserAuthSessionHeaders
  },
  withCredentials: true
})

const refreshAccessToken = async (): Promise<void> => {
  if (refreshAccessTokenPromise !== null) {
    return refreshAccessTokenPromise
  }

  refreshAccessTokenPromise = (async () => {
    try {
      await withSerializedAuthRefresh(async () => {
        const { data } = await refreshApi.post<AuthResponse>('/v1/auth/refresh', {})
        writeAuthToken(data.token)
      })
    } finally {
      refreshAccessTokenPromise = null
    }
  })()

  return refreshAccessTokenPromise
}

const shouldRetryWithRefresh = (
  config: ApiRequestConfig,
  statusCode: number | undefined
): boolean => {
  if (statusCode !== 401) {
    return false
  }

  if (config._retryAuthRefresh || config._skipAuthRefresh) {
    return false
  }

  if (readAuthToken() === null) {
    return false
  }

  const path = resolveRequestPath(config)
  return !authRefreshExcludedPaths.has(path)
}

export const api = axios.create({
  baseURL: webEnv.API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: true
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

      if (shouldRetryWithRefresh(config, statusCode)) {
        finishRequestTelemetry(config, statusCode, error)

        try {
          await refreshAccessToken()
          config._retryAuthRefresh = true
          return await api(config)
        } catch {
          clearAuthToken()
        }
      } else {
        finishRequestTelemetry(config, statusCode, error)
      }
    }

    throw error instanceof Error ? error : new Error('Web API client request failed.')
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
