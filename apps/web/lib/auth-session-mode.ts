import {
  browserAuthSessionModeHeaderName,
  browserAuthSessionModeHeaderValue,
  usesBrowserAuthSessionMode
} from '@tx-agent-kit/contracts'
import type { AxiosRequestConfig } from 'axios'

export { usesBrowserAuthSessionMode } from '@tx-agent-kit/contracts'

export const browserAuthSessionHeaders = {
  [browserAuthSessionModeHeaderName]: browserAuthSessionModeHeaderValue
} as const

export const browserAuthSessionRequestConfig = {
  headers: browserAuthSessionHeaders
} as const

export const withBrowserAuthSessionMode = (
  config: AxiosRequestConfig
): AxiosRequestConfig => {
  if (!usesBrowserAuthSessionMode(config)) {
    return config
  }

  const existingHeaders =
    config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)
      ? Object.fromEntries(Object.entries(config.headers as Record<string, unknown>))
      : {}

  return {
    ...config,
    headers: {
      ...existingHeaders,
      ...browserAuthSessionHeaders
    }
  }
}
