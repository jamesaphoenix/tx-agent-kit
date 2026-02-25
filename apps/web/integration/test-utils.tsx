import React from 'react'
import { AppProviders } from '@/components/providers/AppProviders'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { IntegrationRouterProvider } from './support/next-router-context'

function IntegrationProviders({ children }: { children: ReactNode }) {
  return (
    <IntegrationRouterProvider>
      <AppProviders>{children}</AppProviders>
    </IntegrationRouterProvider>
  )
}

export const renderWithProviders = (
  ui: ReactElement,
  options: RenderOptions = {}
): RenderResult => {
  return render(ui, {
    wrapper: IntegrationProviders,
    ...options
  })
}

export { userEvent }
export * from '@testing-library/react'
