'use client'

import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig
} from 'axios'
import { readAuthToken } from './auth-token'
import { getWebEnv } from './env'

const webEnv = getWebEnv()

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

const attachAuthHeader = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  const token = readAuthToken()

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  } else {
    delete config.headers.Authorization
  }

  return config
}

export const api = axios.create({
  baseURL: webEnv.API_BASE_URL,
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
