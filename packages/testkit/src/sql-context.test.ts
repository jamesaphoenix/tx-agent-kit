import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqlTestContext } from './sql-context.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sql test context headers', () => {
  it('injects testRunId + testCaseId headers', () => {
    const context = createSqlTestContext({
      testRunId: '0194fcff-7108-76e5-a514-288fdb7700d4',
      repoRoot: process.cwd()
    })

    const headers = context.headersForCase('create user', {
      authorization: 'Bearer token'
    })

    expect(headers['x-test-run-id']).toBe('0194fcff-7108-76e5-a514-288fdb7700d4')
    expect(headers['x-test-case-id']).toBe('0194fcff-7108-76e5-a514-288fdb7700d4:create-user')
    expect(headers.authorization).toBe('Bearer token')
  })

  it('rejects non-local database URLs by default', () => {
    expect(() =>
      createSqlTestContext({
        testRunId: '0194fcff-7108-76e5-a514-288fdb7700d4',
        repoRoot: process.cwd(),
        baseDatabaseUrl: 'postgres://postgres:postgres@db.internal:5432/tx_agent_kit'
      })
    ).toThrow('Refusing to run integration DB operations against non-local host')
  })

  it('allows non-local database URLs only when explicit override is set', () => {
    vi.stubEnv('TESTKIT_ALLOW_UNSAFE_DATABASE_URL', 'true')

    expect(() =>
      createSqlTestContext({
        testRunId: '0194fcff-7108-76e5-a514-288fdb7700d4',
        repoRoot: process.cwd(),
        baseDatabaseUrl: 'postgres://postgres:postgres@db.internal:5432/tx_agent_kit'
      })
    ).not.toThrow()
  })
})
