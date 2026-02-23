import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { create } from 'react-test-renderer'
import SignUpScreen from './sign-up'

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

describe('SignUpScreen', () => {
  it('renders create-account heading', () => {
    const tree = create(<SignUpScreen />)
    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Create account')
  })

  it('renders AuthForm with mode sign-up and nextPath /dashboard', () => {
    const tree = create(<SignUpScreen />)
    const authForm = findByType(tree.root, 'AuthForm')[0]

    expect(authForm.props.mode).toBe('sign-up')
    expect(authForm.props.nextPath).toBe('/dashboard')
  })

  it('renders link to sign-in page', () => {
    const tree = create(<SignUpScreen />)
    const link = findByType(tree.root, 'Link')[0]
    expect(link.props.href).toBe('/sign-in')
  })

  it('shows sign-in prompt text', () => {
    const tree = create(<SignUpScreen />)
    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Already have an account?')
    expect(json).toContain('Sign in')
  })
})
