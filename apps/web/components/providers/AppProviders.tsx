'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { NotifyToaster } from '../../lib/notify'
import { UrlStateProvider } from '../../lib/url-state'
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

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <UrlStateProvider>
      <QueryClientProvider client={queryClient}>
        <AuthBootstrapProvider>{children}</AuthBootstrapProvider>
        <NotifyToaster />
      </QueryClientProvider>
    </UrlStateProvider>
  )
}
