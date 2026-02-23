import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'react-test-renderer'
import { AppProviders } from './AppProviders'

vi.mock('@tanstack/react-query', () => {
  const QueryClientProvider = ({ children }: { children: React.ReactNode }) =>
    React.createElement('QueryClientProvider', {}, children)

  class QueryClient {
    private opts: unknown
    constructor(opts?: unknown) {
      this.opts = opts
    }
    getDefaultOptions() {
      return this.opts
    }
  }

  return { QueryClientProvider, QueryClient }
})

vi.mock('./AuthBootstrapProvider', () => ({
  AuthBootstrapProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('AuthBootstrapProvider', {}, children)
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AppProviders', () => {
  it('renders children through both providers without crashing', () => {
    const tree = create(
      <AppProviders>
        <div>child content</div>
      </AppProviders>
    )

    expect(tree.toJSON()).toBeTruthy()
  })

  it('renders children accessible in the tree', () => {
    const tree = create(
      <AppProviders>
        <div>inner</div>
      </AppProviders>
    )

    const json = tree.toJSON()
    expect(JSON.stringify(json)).toContain('inner')
  })
})
