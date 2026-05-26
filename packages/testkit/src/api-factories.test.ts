import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUser, type ApiFactoryContext } from './api-factories.js'
import type { SqlTestContext } from './sql-context.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

const authBody = {
  token: 'access-token',
  refreshToken: 'refresh-token',
  user: {
    id: '0194fcff-7108-76e5-a514-288fdb7700d4',
    email: 'factory@example.com',
    name: 'Factory User',
    createdAt: '2026-05-22T12:00:00.000Z'
  }
}

const createFactoryContext = (): ApiFactoryContext => {
  const testContext: SqlTestContext = {
    testRunId: '0194fcff-7108-76e5-a514-288fdb7700d4',
    schemaName: 'test_schema',
    baseDatabaseUrl: 'postgres://postgres:postgres@localhost:5432/tx_agent_kit',
    schemaDatabaseUrl: 'postgres://postgres:postgres@localhost:5432/tx_agent_kit',
    repoRoot: process.cwd(),
    resetStrategy: 'deferred',
    setup: () => Promise.resolve(),
    reset: () => Promise.resolve(),
    flushReset: () => Promise.resolve(),
    teardown: () => Promise.resolve(),
    withSchemaClient: () =>
      Promise.reject(new Error('withSchemaClient is not used by this unit test')),
    headersForCase: (caseName) => ({
      'x-test-run-id': '0194fcff-7108-76e5-a514-288fdb7700d4',
      'x-test-case-id': `0194fcff-7108-76e5-a514-288fdb7700d4:${caseName}`
    }),
    withEffectContext: (effect) => effect
  }

  return {
    baseUrl: 'http://api.test',
    testContext
  }
}

const readFetchJsonBody = (
  call: Parameters<typeof fetch> | undefined
): Record<string, unknown> => {
  const init = call?.[1]
  if (!init || typeof init.body !== 'string') {
    throw new Error('Expected fetch call to include a JSON string body')
  }

  return JSON.parse(init.body) as Record<string, unknown>
}

describe('createUser', () => {
  it('recovers when sign-up creates the user but initial session creation flakes', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: 'Failed to create login session',
            _tag: 'Unauthorized'
          }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(authBody), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const created = await createUser(createFactoryContext(), {
      email: authBody.user.email,
      password: 'factory-pass-12345',
      name: authBody.user.name
    })

    expect(created.token).toBe(authBody.token)
    expect(created.refreshToken).toBe(authBody.refreshToken)
    expect(created.credentials.email).toBe(authBody.user.email)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://api.test/v1/auth/sign-in')
  })

  it('retries opaque generated sign-up setup failures with a fresh email', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Sign-up failed', _tag: 'BadRequest' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(authBody), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    const created = await createUser(createFactoryContext(), {
      name: authBody.user.name
    })

    const firstBody = readFetchJsonBody(fetchMock.mock.calls[0])
    const secondBody = readFetchJsonBody(fetchMock.mock.calls[1])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(firstBody.email).not.toBe(secondBody.email)
    expect(created.credentials.email).toBe(secondBody.email)
  })
})
