'use client'

import type { Params } from 'next/dist/server/request/params'
import {
  AppRouterContext,
  type AppRouterInstance
} from 'next/dist/shared/lib/app-router-context.shared-runtime'
import {
  PathnameContext,
  PathParamsContext,
  SearchParamsContext
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import {
  readBrowserLocationState,
  resolveBrowserUrl
} from '@/lib/url-state'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'

const toUrl = (href: string): URL => resolveBrowserUrl(href)

const updateLocationState = (href: string, replace: boolean): URL => {
  const target = toUrl(href)
  const nextHref = `${target.pathname}${target.search}`

  if (replace) {
    window.history.replaceState(null, '', nextHref)
  } else {
    window.history.pushState(null, '', nextHref)
  }

  return target
}

export const readIntegrationRouterLocation = (): { pathname: string; search: string } => ({
  pathname: readBrowserLocationState().pathname,
  search: readBrowserLocationState().search
})

export const resetIntegrationRouterLocation = (href = '/'): void => {
  const target = toUrl(href)
  window.history.replaceState(null, '', `${target.pathname}${target.search}`)
}

export const IntegrationRouterProvider = ({
  children
}: {
  children: ReactNode
}) => {
  const [pathname, setPathname] = useState<string>(() =>
    readBrowserLocationState().pathname
  )
  const [searchParams, setSearchParams] = useState<URLSearchParams>(
    () => new URLSearchParams(readBrowserLocationState().search)
  )

  const navigate = useCallback((href: string, replace: boolean) => {
    const target = updateLocationState(href, replace)
    setPathname(target.pathname || '/')
    setSearchParams(new URLSearchParams(target.search))
  }, [])

  const router = useMemo<AppRouterInstance>(
    () => ({
      back: () => window.history.back(),
      forward: () => window.history.forward(),
      refresh: () => undefined,
      prefetch: () => undefined,
      push: (href: string) => {
        navigate(href, false)
      },
      replace: (href: string) => {
        navigate(href, true)
      }
    }),
    [navigate]
  )

  return (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={pathname}>
        <SearchParamsContext.Provider value={searchParams}>
          <PathParamsContext.Provider value={{} as Params}>
            {children}
          </PathParamsContext.Provider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  )
}
