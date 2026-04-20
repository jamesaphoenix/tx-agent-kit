'use client'

import type { ReactNode } from 'react'
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs'
import { NuqsAdapter } from 'nuqs/adapters/next/app'

export const sanitizeInternalPath = (value: string | null, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback
  }

  return value.startsWith('/') && !value.startsWith('//') ? value : fallback
}

export const UrlStateProvider = ({ children }: { children: ReactNode }) => {
  return <NuqsAdapter>{children}</NuqsAdapter>
}

export const useSafeNextPath = (fallback = '/dashboard'): string => {
  const [nextPath] = useQueryState('next', parseAsString)
  return sanitizeInternalPath(nextPath, fallback)
}

export const useStringQueryParam = (key: string): string | null => {
  const [value] = useQueryState(key, parseAsString)
  return value
}

export const usePageQueryState = (defaultPage = 1) => {
  return useQueryState('page', parseAsInteger.withDefault(defaultPage))
}

export const useTabQueryState = (defaultTab: string) => {
  return useQueryState('tab', parseAsString.withDefault(defaultTab))
}

export interface BrowserLocationState {
  readonly pathname: string
  readonly search: string
  readonly origin: string
}

export const readBrowserLocationState = (): BrowserLocationState => {
  if (typeof window === 'undefined') {
    return {
      pathname: '/',
      search: '',
      origin: 'http://localhost'
    }
  }

  return {
    pathname: globalThis.location.pathname || '/',
    search: globalThis.location.search || '',
    origin: globalThis.location.origin || 'http://localhost'
  }
}

export const resolveBrowserUrl = (href: string): URL => {
  const location = readBrowserLocationState()
  return new URL(href, location.origin)
}

type ExternalNavigationHandler = (url: string) => void

let externalNavigationHandler: ExternalNavigationHandler | null = null

export const configureExternalNavigationHandler = (
  handler: ExternalNavigationHandler | null
): void => {
  externalNavigationHandler = handler
}

/**
 * Navigate the current tab to an absolute external URL (e.g. a
 * Stripe-hosted checkout page). Thin wrapper over `globalThis.location.assign`
 * so components never reach for the browser location API directly —
 * the `enforce-web-client-contracts.mjs` invariant forbids that pattern
 * everywhere except this url-state wrapper.
 */
export const navigateToExternalUrl = (url: string): void => {
  if (typeof globalThis === 'undefined') {
    return
  }
  if (externalNavigationHandler !== null) {
    externalNavigationHandler(url)
    return
  }
  globalThis.location.assign(url)
}
