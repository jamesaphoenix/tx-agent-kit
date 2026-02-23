import { getClientHttpTelemetry } from '@tx-agent-kit/observability/client'
import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig
} from 'axios'
import { readAuthToken } from './auth-token'
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

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  } else {
    delete config.headers.Authorization
  }

  return startRequestTelemetry(config)
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
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.config) {
      finishRequestTelemetry(error.config, error.response?.status, error)
    }

    const rejectionError =
      error instanceof Error ? error : new Error('Mobile API client request failed.')
    return Promise.reject(rejectionError)
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

  return payload.error?.message ?? payload.message ?? error.message ?? fallback
}

export type ApiAxiosRequestConfig = AxiosRequestConfig
export type ApiAxiosError<T = unknown> = AxiosError<T>
