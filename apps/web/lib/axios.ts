'use client'

import axios, {
  type AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from 'axios'

const TOKEN_COOKIE_NAME = 'tx_agent_token'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000'

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
  return true
}

const getCookieValue = (name: string): string | null => {
  if (typeof document === 'undefined') {
    return null
  }

  const encodedName = `${encodeURIComponent(name)}=`
  const pairs = document.cookie.split(';')
  for (const rawPair of pairs) {
    const pair = rawPair.trim()
    if (pair.startsWith(encodedName)) {
      return decodeURIComponent(pair.slice(encodedName.length))
    }
  }

  return null
}

const setCookieValue = (name: string, value: string, maxAgeSeconds: number): void => {
  if (typeof document === 'undefined') {
    return
  }

  const securePart = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${securePart}`
}

export const setSessionToken = (token: string): void => {
  setCookieValue(TOKEN_COOKIE_NAME, token, SESSION_MAX_AGE_SECONDS)
}

export const clearSessionToken = (): void => {
  setCookieValue(TOKEN_COOKIE_NAME, '', 0)
}

export const getSessionToken = (): string | null => {
  return getCookieValue(TOKEN_COOKIE_NAME)
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getSessionToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

api.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => response,
  (error: AxiosError<ApiErrorPayload>): Promise<never> => {
    if (error.response?.status === 401) {
      clearSessionToken()
    }

    return Promise.reject(error instanceof Error ? error : new Error('API request failed'))
  }
)

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (!axios.isAxiosError(error)) {
    return fallback
  }

  const payload = error.response?.data
  if (!isApiErrorPayload(payload)) {
    return error.message || fallback
  }

  return payload.error?.message ?? payload.message ?? error.message ?? fallback
}
