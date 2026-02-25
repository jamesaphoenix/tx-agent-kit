import React from 'react'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { useRouter } from 'expo-router'
import { createUser } from '../../../packages/testkit/src/index.ts'
import { AuthForm } from './AuthForm'
import { createMobileFactoryContext } from '../integration/support/mobile-integration-context'
import { waitFor } from '../integration/support/wait-for'
import { readAuthToken } from '../lib/auth-token'
import { sessionStore, sessionStoreSelectors } from '../stores/session-store'

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

const hasText = (
  root: ReturnType<typeof create>['root'],
  pattern: RegExp
): boolean =>
  findByType(root, 'Text').some((textNode) => {
    const children = textNode.props.children
    const content = Array.isArray(children) ? children.join('') : String(children ?? '')
    return pattern.test(content)
  })

describe('AuthForm integration', () => {
  let routerReplace: Mock

  beforeEach(() => {
    routerReplace = vi.fn()
    const mockRouter = {
      replace: routerReplace,
      push: vi.fn(),
      back: vi.fn()
    }
    ;(useRouter as Mock).mockReturnValue(mockRouter)
  })

  it('signs up through the real API and stores authenticated mobile session state', async () => {
    const email = `mobile-auth-${randomUUID()}@example.com`
    const nextPath = '/dashboard'

    const tree = create(<AuthForm mode="sign-up" nextPath={nextPath} />)
    const inputs = findByType(tree.root, 'TextInput')

    await act(async () => {
      inputs.find((input) => input.props.placeholder === 'Jane Founder')?.props.onChangeText('Mobile User')
      inputs.find((input) => input.props.placeholder === 'you@company.com')?.props.onChangeText(email)
      inputs.find((input) => input.props.placeholder === 'At least 8 characters')?.props.onChangeText('strong-pass-12345')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
    })

    await waitFor(() => routerReplace.mock.calls.length > 0)
    await waitFor(async () => (await readAuthToken()) !== null)
    await waitFor(() => sessionStoreSelectors.getPrincipal(sessionStore.state)?.email === email)

    expect(routerReplace).toHaveBeenCalledWith(nextPath)

    const token = await readAuthToken()
    expect(token).toBeTruthy()

    const principal = sessionStoreSelectors.getPrincipal(sessionStore.state)
    expect(principal?.email).toBe(email)
    expect(sessionStoreSelectors.getIsAuthenticated(sessionStore.state)).toBe(true)
  })

  it('shows an error when sign-up email is already in use', async () => {
    const factoryContext = createMobileFactoryContext()
    const existing = await createUser(factoryContext, {
      email: `mobile-sign-up-duplicate-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Existing Sign Up User'
    })

    const tree = create(<AuthForm mode="sign-up" nextPath="/dashboard" />)
    const inputs = findByType(tree.root, 'TextInput')

    await act(async () => {
      inputs.find((input) => input.props.placeholder === 'Jane Founder')?.props.onChangeText('Duplicate User')
      inputs.find((input) => input.props.placeholder === 'you@company.com')?.props.onChangeText(existing.user.email)
      inputs.find((input) => input.props.placeholder === 'At least 8 characters')?.props.onChangeText('strong-pass-12345')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
    })

    await waitFor(() =>
      hasText(tree.root, /email is already in use|sign-up failed|conflict/i)
    )

    expect(routerReplace).not.toHaveBeenCalled()
    expect(await readAuthToken()).toBeNull()
    expect(sessionStoreSelectors.getPrincipal(sessionStore.state)).toBeNull()
    expect(sessionStoreSelectors.getIsAuthenticated(sessionStore.state)).toBe(false)
  })

  it('signs in through the real API and stores authenticated mobile session state', async () => {
    const factoryContext = createMobileFactoryContext()
    const existing = await createUser(factoryContext, {
      email: `mobile-sign-in-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Sign In User'
    })
    const nextPath = '/organizations'

    const tree = create(<AuthForm mode="sign-in" nextPath={nextPath} />)
    const inputs = findByType(tree.root, 'TextInput')

    await act(async () => {
      inputs.find((input) => input.props.placeholder === 'you@company.com')?.props.onChangeText(existing.user.email)
      inputs.find((input) => input.props.placeholder === 'At least 8 characters')?.props.onChangeText('strong-pass-12345')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
    })

    await waitFor(() => routerReplace.mock.calls.length > 0)
    await waitFor(async () => (await readAuthToken()) !== null)
    await waitFor(() => sessionStoreSelectors.getPrincipal(sessionStore.state)?.email === existing.user.email)

    expect(routerReplace).toHaveBeenCalledWith(nextPath)
    expect(await readAuthToken()).toBeTruthy()
    expect(sessionStoreSelectors.getPrincipal(sessionStore.state)?.email).toBe(existing.user.email)
    expect(sessionStoreSelectors.getIsAuthenticated(sessionStore.state)).toBe(true)
  })

  it('shows an error when sign-in credentials are invalid', async () => {
    const factoryContext = createMobileFactoryContext()
    const existing = await createUser(factoryContext, {
      email: `mobile-sign-in-invalid-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Invalid Sign In User'
    })

    const tree = create(<AuthForm mode="sign-in" nextPath="/organizations" />)
    const inputs = findByType(tree.root, 'TextInput')

    await act(async () => {
      inputs.find((input) => input.props.placeholder === 'you@company.com')?.props.onChangeText(existing.user.email)
      inputs.find((input) => input.props.placeholder === 'At least 8 characters')?.props.onChangeText('wrong-pass-12345')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
    })

    await waitFor(() => hasText(tree.root, /invalid credentials|authentication failed/i))

    expect(routerReplace).not.toHaveBeenCalled()
    expect(await readAuthToken()).toBeNull()
    expect(sessionStoreSelectors.getPrincipal(sessionStore.state)).toBeNull()
    expect(sessionStoreSelectors.getIsAuthenticated(sessionStore.state)).toBe(false)
  })
})
