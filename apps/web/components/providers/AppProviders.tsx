'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { getWebEnv } from '../../lib/env'
import { NotifyToaster } from '../../lib/notify'
import { initializeWebSentry } from '../../lib/sentry'
import { UrlStateProvider } from '../../lib/url-state'
import { sessionStore } from '../../stores/session-store'
import { TanStackStoreDevtools } from '../devtools/TanStackStoreDevtools'
import { AuthBootstrapProvider } from './AuthBootstrapProvider'

const createQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 15_000
      },
      mutations: {
        retry: 0
      }
    }
  })
}

export type DevtoolsMode = 'auto' | 'enabled' | 'disabled'

export const resolveShouldRenderDevtools = (
  nodeEnv: string,
  mode: DevtoolsMode
): boolean => {
  if (mode === 'enabled') {
    return true
  }

  if (mode === 'disabled') {
    return false
  }

  return nodeEnv !== 'production'
}

export interface AppProvidersProps {
  children: ReactNode
  devtoolsMode?: DevtoolsMode
}

export function AppProviders({ children, devtoolsMode = 'auto' }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient)
  const webEnv = getWebEnv()
  const shouldRenderDevtools = resolveShouldRenderDevtools(webEnv.NODE_ENV, devtoolsMode)

  useEffect(() => {
    void initializeWebSentry()
  }, [])

  return (
    <UrlStateProvider>
      <QueryClientProvider client={queryClient}>
        <AuthBootstrapProvider>{children}</AuthBootstrapProvider>
        <NotifyToaster />
        {shouldRenderDevtools ? (
          <>
            <div data-testid="react-query-devtools-container">
              <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
            </div>
            <TanStackStoreDevtools
              store={sessionStore}
              name="Session Store Devtools"
              maxHistory={30}
            />
          </>
        ) : null}
      </QueryClientProvider>
    </UrlStateProvider>
  )
}
