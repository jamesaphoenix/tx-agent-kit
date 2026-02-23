import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig
} from 'axios'
import { readAuthToken } from './auth-token'
import { getMobileEnv } from './env'

const mobileEnv = getMobileEnv()

interface ApiErrorPayload {
  message?: string
  error?: {
    message?: string
  }
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

  return config
}

export const api = axios.create({
  baseURL: mobileEnv.API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

api.interceptors.request.use(attachAuthHeader)

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
