import { describe, expect, it } from 'vitest'
import {
  browserAuthSessionHeaders,
  usesBrowserAuthSessionMode,
  withBrowserAuthSessionMode
} from './auth-session-mode'

describe('auth session mode', () => {
  it('marks browser-managed auth endpoints explicitly', () => {
    expect(
      usesBrowserAuthSessionMode({
        method: 'post',
        url: '/v1/auth/sign-in'
      })
    ).toBe(true)

    expect(
      usesBrowserAuthSessionMode({
        method: 'post',
        url: '/v1/auth/sign-up'
      })
    ).toBe(true)

    expect(
      usesBrowserAuthSessionMode({
        method: 'post',
        url: '/v1/auth/refresh'
      })
    ).toBe(true)

    expect(
      usesBrowserAuthSessionMode({
        method: 'get',
        url: '/v1/auth/google/start'
      })
    ).toBe(true)
  })

  it('does not mark unrelated auth endpoints as browser-managed', () => {
    expect(
      usesBrowserAuthSessionMode({
        method: 'post',
        url: '/v1/auth/sign-out'
      })
    ).toBe(false)

    expect(
      usesBrowserAuthSessionMode({
        method: 'get',
        url: '/v1/auth/me'
      })
    ).toBe(false)
  })

  it('injects the browser session header for generated auth calls', () => {
    expect(
      withBrowserAuthSessionMode({
        method: 'post',
        url: '/v1/auth/sign-in'
      })
    ).toMatchObject({
      headers: browserAuthSessionHeaders
    })
  })
})
