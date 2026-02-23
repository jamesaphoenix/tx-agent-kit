import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { create } from 'react-test-renderer'
import SignInScreen from './sign-in'

vi.mock('expo-router', () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  Link: ({ children, ...props }: Record<string, unknown>) =>
    React.createElement('Link', props, children as React.ReactNode)
}))

vi.mock('../../lib/url-state', () => ({
  useSafeNextPath: vi.fn((fallback: string) => fallback)
}))

vi.mock('../../components/AuthForm', () => ({
  AuthForm: (props: Record<string, unknown>) =>
    React.createElement('AuthForm', props)
}))

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

describe('SignInScreen', () => {
  it('renders sign-in heading', () => {
    const tree = create(<SignInScreen />)
    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Sign in')
  })

  it('renders AuthForm with mode sign-in and nextPath /dashboard', () => {
    const tree = create(<SignInScreen />)
    const authForm = findByType(tree.root, 'AuthForm')[0]

    expect(authForm.props.mode).toBe('sign-in')
    expect(authForm.props.nextPath).toBe('/dashboard')
  })

  it('renders link to sign-up page', () => {
    const tree = create(<SignInScreen />)
    const link = findByType(tree.root, 'Link')[0]
    expect(link.props.href).toBe('/sign-up')
  })

  it('shows create-account prompt text', () => {
    const tree = create(<SignInScreen />)
    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('No account yet?')
    expect(json).toContain('Create one')
  })
})
