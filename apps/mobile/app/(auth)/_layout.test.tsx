import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import AuthLayout from './_layout'
import { useIsSessionReady, useIsAuthenticated } from '../../hooks/use-session-store'

const mockReplace = vi.fn()

vi.mock('expo-router', () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  Stack: ({ children, ...props }: Record<string, unknown>) =>
    require('react').createElement('Stack', props, children)
}))

vi.mock('../../hooks/use-session-store', () => ({
  useIsSessionReady: vi.fn(),
  useIsAuthenticated: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AuthLayout', () => {
  it('does not redirect when session is not ready', () => {
    ;(useIsSessionReady as Mock).mockReturnValue(false)
    ;(useIsAuthenticated as Mock).mockReturnValue(false)

    create(<AuthLayout />)

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('redirects to /dashboard when ready and authenticated', async () => {
    ;(useIsSessionReady as Mock).mockReturnValue(true)
    ;(useIsAuthenticated as Mock).mockReturnValue(true)

    await act(async () => {
      create(<AuthLayout />)
    })

    expect(mockReplace).toHaveBeenCalledWith('/dashboard')
  })

  it('does not redirect when ready but not authenticated', async () => {
    ;(useIsSessionReady as Mock).mockReturnValue(true)
    ;(useIsAuthenticated as Mock).mockReturnValue(false)

    await act(async () => {
      create(<AuthLayout />)
    })

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('renders a Stack navigator', () => {
    ;(useIsSessionReady as Mock).mockReturnValue(false)
    ;(useIsAuthenticated as Mock).mockReturnValue(false)

    const tree = create(<AuthLayout />)
    expect(tree.toJSON()).toBeTruthy()
  })
})
