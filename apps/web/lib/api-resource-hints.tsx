'use client'

import { preconnect, prefetchDNS } from 'react-dom'
import { getWebEnv } from './env'

const parseUrl = (value: string, base?: string): URL | null => {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

const isHttpUrl = (url: URL): boolean => url.protocol === 'http:' || url.protocol === 'https:'

export const resolveApiResourceHintOrigin = (
  apiBaseUrl: string,
  siteUrl: string
): string | null => {
  const normalizedApiBaseUrl = apiBaseUrl.trim()
  if (normalizedApiBaseUrl.length === 0) {
    return null
  }

  const normalizedSiteUrl = siteUrl.trim()
  const siteOrigin =
    normalizedSiteUrl.length > 0 ? parseUrl(normalizedSiteUrl)?.origin ?? null : null
  const apiUrl = parseUrl(
    normalizedApiBaseUrl,
    normalizedSiteUrl.length > 0 ? normalizedSiteUrl : undefined
  )

  if (!apiUrl || !isHttpUrl(apiUrl)) {
    return null
  }

  if (siteOrigin && apiUrl.origin === siteOrigin) {
    return null
  }

  return apiUrl.origin
}

export const ApiResourceHints = () => {
  const { API_BASE_URL, SITE_URL } = getWebEnv()
  const apiOrigin = resolveApiResourceHintOrigin(API_BASE_URL, SITE_URL)

  if (!apiOrigin) {
    return null
  }

  prefetchDNS(apiOrigin)
  preconnect(apiOrigin, { crossOrigin: 'use-credentials' })

  return null
}
