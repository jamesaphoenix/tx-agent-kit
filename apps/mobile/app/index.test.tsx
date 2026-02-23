import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import IndexPage from './index'
import { useIsSessionReady, useIsAuthenticated } from '../hooks/use-session-store'

const mockReplace = vi.fn()

vi.mock('expo-router', () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace }))
}))

vi.mock('../hooks/use-session-store', () => ({
  useIsSessionReady: vi.fn(),
  useIsAuthenticated: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('IndexPage', () => {
  it('does not redirect when session is not ready', () => {
    ;(useIsSessionReady as Mock).mockReturnValue(false)
    ;(useIsAuthenticated as Mock).mockReturnValue(false)

    create(<IndexPage />)

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('redirects to /dashboard when ready and authenticated', async () => {
    ;(useIsSessionReady as Mock).mockReturnValue(true)
    ;(useIsAuthenticated as Mock).mockReturnValue(true)

    await act(async () => {
      create(<IndexPage />)
    })

    expect(mockReplace).toHaveBeenCalledWith('/dashboard')
  })

  it('redirects to /sign-in when ready and not authenticated', async () => {
    ;(useIsSessionReady as Mock).mockReturnValue(true)
    ;(useIsAuthenticated as Mock).mockReturnValue(false)

    await act(async () => {
      create(<IndexPage />)
    })

    expect(mockReplace).toHaveBeenCalledWith('/sign-in')
  })

  it('renders null', () => {
    ;(useIsSessionReady as Mock).mockReturnValue(false)
    ;(useIsAuthenticated as Mock).mockReturnValue(false)

    const tree = create(<IndexPage />)
    expect(tree.toJSON()).toBeNull()
  })
})
