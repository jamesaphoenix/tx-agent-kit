import React from 'react'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { useRouter } from 'expo-router'
import { AuthForm } from './AuthForm'
import { waitFor } from '../integration/support/wait-for'
import { readAuthToken } from '../lib/auth-token'
import { sessionStore, sessionStoreSelectors } from '../stores/session-store'

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

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
})
