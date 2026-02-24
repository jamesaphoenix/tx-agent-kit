import React from 'react'
import { randomUUID } from 'node:crypto'
import { create, act } from 'react-test-renderer'
import { useRouter } from 'expo-router'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createUser } from '../../../packages/testkit/src/index.ts'
import { createMobileFactoryContext } from '../integration/support/mobile-integration-context'
import { readAuthToken, writeAuthToken } from '../lib/auth-token'
import { SignOutButton } from './SignOutButton'
import { sessionStore, sessionStoreActions, sessionStoreSelectors } from '../stores/session-store'

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('SignOutButton integration', () => {
  let routerReplace: Mock

  beforeEach(() => {
    routerReplace = vi.fn()
    ;(useRouter as Mock).mockReturnValue({
      replace: routerReplace,
      push: vi.fn(),
      back: vi.fn()
    })
  })

  it('clears auth token and session state through real sign-out flow', async () => {
    const factoryContext = createMobileFactoryContext()

    const user = await createUser(factoryContext, {
      email: `mobile-signout-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Sign Out User'
    })

    await writeAuthToken(user.token)
    sessionStoreActions.setPrincipal({
      userId: user.user.id,
      email: user.user.email,
      roles: ['member']
    })

    const tree = create(<SignOutButton />)

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0]?.props.onPress()
    })

    await flush()
    await flush()

    const tokenAfterSignOut = await readAuthToken()
    expect(tokenAfterSignOut).toBeNull()
    expect(sessionStoreSelectors.getPrincipal(sessionStore.state)).toBeNull()
    expect(routerReplace).toHaveBeenCalledWith('/sign-in')
  })
})
