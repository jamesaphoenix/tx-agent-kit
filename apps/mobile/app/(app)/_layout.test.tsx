import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import AppTabLayout from './_layout'
import { useIsSessionReady, useIsAuthenticated } from '../../hooks/use-session-store'

const mockReplace = vi.fn()

vi.mock('expo-router', () => {
  const TabsComponent = ({ children, ...props }: Record<string, unknown>) =>
    require('react').createElement('Tabs', props, children)
  TabsComponent.Screen = ({ name, ...props }: Record<string, unknown>) =>
    require('react').createElement('Tabs.Screen', { name, ...props })
  return {
    useRouter: vi.fn(() => ({ replace: mockReplace })),
    Tabs: TabsComponent
  }
})

vi.mock('../../hooks/use-session-store', () => ({
  useIsSessionReady: vi.fn(),
  useIsAuthenticated: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AppTabLayout', () => {
  it('renders null when session is not ready', () => {
    ;(useIsSessionReady as Mock).mockReturnValue(false)
    ;(useIsAuthenticated as Mock).mockReturnValue(false)

    const tree = create(<AppTabLayout />)
    expect(tree.toJSON()).toBeNull()
  })

  it('renders null and redirects to /sign-in when ready but not authenticated', async () => {
    ;(useIsSessionReady as Mock).mockReturnValue(true)
    ;(useIsAuthenticated as Mock).mockReturnValue(false)

    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(<AppTabLayout />)
    })

    expect(tree!.toJSON()).toBeNull()
    expect(mockReplace).toHaveBeenCalledWith('/sign-in')
  })

  it('renders tabs when ready and authenticated', async () => {
    ;(useIsSessionReady as Mock).mockReturnValue(true)
    ;(useIsAuthenticated as Mock).mockReturnValue(true)

    let tree: ReturnType<typeof create>
    await act(async () => {
      tree = create(<AppTabLayout />)
    })

    expect(tree!.toJSON()).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('does not redirect when session is not ready', () => {
    ;(useIsSessionReady as Mock).mockReturnValue(false)
    ;(useIsAuthenticated as Mock).mockReturnValue(true)

    create(<AppTabLayout />)

    expect(mockReplace).not.toHaveBeenCalled()
  })
})
