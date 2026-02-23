import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { useRouter } from 'expo-router'
import { AuthForm } from './AuthForm'
import { clearAuthToken } from '../lib/auth-token'
import { clientApi, ApiClientError } from '../lib/client-api'
import { notify } from '../lib/notify'
import { sessionStoreActions } from '../stores/session-store'

vi.mock('../lib/auth-token', () => ({
  clearAuthToken: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../lib/client-api', () => {
  class MockApiClientError extends Error {
    readonly status: number | undefined
    constructor(message: string, status?: number) {
      super(message)
      Object.setPrototypeOf(this, new.target.prototype)
      this.name = 'ApiClientError'
      this.status = status
    }
  }
  return {
    ApiClientError: MockApiClientError,
    clientApi: {
      signIn: vi.fn(),
      signUp: vi.fn(),
      me: vi.fn()
    }
  }
})

vi.mock('../lib/notify', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('../stores/session-store', () => ({
  sessionStoreActions: {
    setPrincipal: vi.fn(),
    clear: vi.fn()
  }
}))

const mockReplace = vi.fn()
const mockRouter = { replace: mockReplace, push: vi.fn(), back: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  ;(useRouter as Mock).mockReturnValue(mockRouter)
})

const principal = {
  userId: 'u-1',
  email: 'test@example.com',
  roles: ['member'] as readonly string[]
}

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

const fillAndSubmit = async (tree: ReturnType<typeof create>, mode: 'sign-in' | 'sign-up') => {
  const inputs = findByType(tree.root, 'TextInput')

  await act(async () => {
    if (mode === 'sign-up') {
      inputs.find((i) => i.props.placeholder === 'Jane Founder')!.props.onChangeText('Test User')
    }
    inputs.find((i) => i.props.placeholder === 'you@company.com')!.props.onChangeText('a@b.com')
    inputs.find((i) => i.props.placeholder === 'At least 8 characters')!.props.onChangeText('pass1234')
  })

  await act(async () => {
    findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
  })

  await flush()
}

describe('AuthForm', () => {
  describe('sign-in mode', () => {
    it('renders email and password inputs but no name input', () => {
      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      const inputs = findByType(tree.root, 'TextInput')

      const placeholders = inputs.map((i) => i.props.placeholder)
      expect(placeholders).toContain('you@company.com')
      expect(placeholders).toContain('At least 8 characters')
      expect(placeholders).not.toContain('Jane Founder')
    })

    it('renders Sign in button text', () => {
      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      const texts = findByType(tree.root, 'Text')
      const labels = texts.map((t) => t.props.children).flat()
      expect(labels).toContain('Sign in')
    })

    it('calls signIn, fetches principal, and redirects on success', async () => {
      ;(clientApi.signIn as Mock).mockResolvedValue(undefined)
      ;(clientApi.me as Mock).mockResolvedValue(principal)

      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      await fillAndSubmit(tree, 'sign-in')

      expect(clientApi.signIn).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'pass1234'
      })
      expect(clientApi.me).toHaveBeenCalled()
      expect(sessionStoreActions.setPrincipal).toHaveBeenCalledWith(principal)
      expect(notify.success).toHaveBeenCalledWith('Signed in successfully')
      expect(mockReplace).toHaveBeenCalledWith('/dashboard')
    })

    it('displays error and notifies on sign-in failure', async () => {
      ;(clientApi.signIn as Mock).mockRejectedValue(new Error('Invalid credentials'))

      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      await fillAndSubmit(tree, 'sign-in')

      expect(notify.error).toHaveBeenCalledWith('Invalid credentials')
      expect(sessionStoreActions.clear).not.toHaveBeenCalled()

      const texts = findByType(tree.root, 'Text')
      const labels = texts.map((t) => t.props.children).flat()
      expect(labels).toContain('Sign in')
    })

    it('resets pending state via finally block even if me() fails', async () => {
      ;(clientApi.signIn as Mock).mockResolvedValue(undefined)
      ;(clientApi.me as Mock).mockRejectedValue(new Error('Network error'))

      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      await fillAndSubmit(tree, 'sign-in')

      const texts = findByType(tree.root, 'Text')
      const labels = texts.map((t) => t.props.children).flat()
      expect(labels).toContain('Sign in')
      expect(labels).not.toContain('Working...')
    })

    it('clears auth token only on 401/403 auth rejection', async () => {
      ;(clientApi.signIn as Mock).mockResolvedValue(undefined)
      ;(clientApi.me as Mock).mockRejectedValue(new ApiClientError('Unauthorized', 401))

      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      await fillAndSubmit(tree, 'sign-in')

      expect(clearAuthToken).toHaveBeenCalled()
      expect(sessionStoreActions.clear).toHaveBeenCalled()
    })

    it('clears auth token and session on 403 auth rejection', async () => {
      ;(clientApi.signIn as Mock).mockResolvedValue(undefined)
      ;(clientApi.me as Mock).mockRejectedValue(new ApiClientError('Forbidden', 403))

      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      await fillAndSubmit(tree, 'sign-in')

      expect(clearAuthToken).toHaveBeenCalled()
      expect(sessionStoreActions.clear).toHaveBeenCalled()
    })

    it('does NOT clear auth token or session on network errors', async () => {
      ;(clientApi.signIn as Mock).mockResolvedValue(undefined)
      ;(clientApi.me as Mock).mockRejectedValue(new Error('Network error'))

      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      await fillAndSubmit(tree, 'sign-in')

      expect(clearAuthToken).not.toHaveBeenCalled()
      expect(sessionStoreActions.clear).not.toHaveBeenCalled()
    })

    it('prevents double-submit while pending', async () => {
      let resolveSignIn!: (v: unknown) => void
      ;(clientApi.signIn as Mock).mockImplementation(
        () => new Promise((r) => { resolveSignIn = r })
      )

      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      await act(async () => {
        const inputs = findByType(tree.root, 'TextInput')
        inputs.find((i) => i.props.placeholder === 'you@company.com')!.props.onChangeText('a@b.com')
        inputs.find((i) => i.props.placeholder === 'At least 8 characters')!.props.onChangeText('pass1234')
      })

      // First submit
      await act(async () => {
        findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
      })

      // Second submit while pending
      await act(async () => {
        findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
      })

      await act(async () => {
        resolveSignIn(undefined)
        ;(clientApi.me as Mock).mockResolvedValue(principal)
        await new Promise((r) => setTimeout(r, 0))
      })

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(clientApi.signIn).toHaveBeenCalledTimes(1)
    })

    it('does NOT clear auth token or session on 500 server errors', async () => {
      ;(clientApi.signIn as Mock).mockRejectedValue(new ApiClientError('Server error', 500))

      const tree = create(<AuthForm mode="sign-in" nextPath="/dashboard" />)
      await fillAndSubmit(tree, 'sign-in')

      expect(clearAuthToken).not.toHaveBeenCalled()
      expect(sessionStoreActions.clear).not.toHaveBeenCalled()
    })
  })

  describe('sign-up mode', () => {
    it('renders name field and Create account button', () => {
      const tree = create(<AuthForm mode="sign-up" nextPath="/dashboard" />)
      const inputs = findByType(tree.root, 'TextInput')
      const placeholders = inputs.map((i) => i.props.placeholder)
      expect(placeholders).toContain('Jane Founder')

      const texts = findByType(tree.root, 'Text')
      const labels = texts.map((t) => t.props.children).flat()
      expect(labels).toContain('Create account')
    })

    it('calls signUp with name, email, and password', async () => {
      ;(clientApi.signUp as Mock).mockResolvedValue(undefined)
      ;(clientApi.me as Mock).mockResolvedValue(principal)

      const tree = create(<AuthForm mode="sign-up" nextPath="/dashboard" />)
      await fillAndSubmit(tree, 'sign-up')

      expect(clientApi.signUp).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'pass1234',
        name: 'Test User'
      })
      expect(notify.success).toHaveBeenCalledWith('Account created successfully')
      expect(mockReplace).toHaveBeenCalledWith('/dashboard')
    })
  })
})
