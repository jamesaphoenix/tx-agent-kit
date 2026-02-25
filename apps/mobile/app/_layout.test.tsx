import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create, act } from 'react-test-renderer'
import RootLayout from './_layout'

const { initializeMobileSentryMock } = vi.hoisted(() => ({
  initializeMobileSentryMock: vi.fn()
}))

vi.mock('expo-router', () => ({
  Slot: () => React.createElement('Slot')
}))

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('SafeAreaProvider', {}, children)
}))

vi.mock('expo-status-bar', () => ({
  StatusBar: () => React.createElement('StatusBar')
}))

vi.mock('../components/providers/AppProviders', () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) =>
    React.createElement('AppProviders', {}, children)
}))

vi.mock('../lib/notify', () => ({
  NotifyToaster: () => React.createElement('NotifyToaster')
}))

vi.mock('../lib/sentry', () => ({
  initializeMobileSentry: initializeMobileSentryMock
}))

describe('RootLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders providers and initializes sentry once', async () => {
    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(<RootLayout />)
    })

    expect(tree!.toJSON()).toBeTruthy()
    expect(initializeMobileSentryMock).toHaveBeenCalledTimes(1)
  })
})
