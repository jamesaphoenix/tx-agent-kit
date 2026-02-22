import { describe, expect, it } from 'vitest'
import { createSqlTestContext } from './sql-context.js'

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
})
