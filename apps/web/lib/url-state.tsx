'use client'

import type { ReactNode } from 'react'
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs'
import { NuqsAdapter } from 'nuqs/adapters/next/app'

const sanitizeInternalPath = (value: string | null, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback
  }

  return value.startsWith('/') ? value : fallback
}

export const UrlStateProvider = ({ children }: { children: ReactNode }) => {
  return <NuqsAdapter>{children}</NuqsAdapter>
}

export const useSafeNextPath = (fallback = '/dashboard'): string => {
  const [nextPath] = useQueryState('next', parseAsString)
  return sanitizeInternalPath(nextPath, fallback)
}

export const usePageQueryState = (defaultPage = 1) => {
  return useQueryState('page', parseAsInteger.withDefault(defaultPage))
}

export const useTabQueryState = (defaultTab: string) => {
  return useQueryState('tab', parseAsString.withDefault(defaultTab))
}
