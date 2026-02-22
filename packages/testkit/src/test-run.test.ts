import { describe, expect, it } from 'vitest'
import {
  buildSchemaDatabaseUrl,
  buildSchemaName,
  compactTestRunId,
  createTestCaseId,
  createTestRunId,
  isValidTestRunId
} from './test-run.js'

describe('test run primitives', () => {
  it('creates UUID v7 run ids', () => {
    const runId = createTestRunId()
    expect(isValidTestRunId(runId)).toBe(true)
  })

  it('creates deterministic case ids', () => {
    const runId = '0194fcff-7108-76e5-a514-288fdb7700d4'
    expect(createTestCaseId(runId, 'Auth Sign Up Flow')).toBe(
      '0194fcff-7108-76e5-a514-288fdb7700d4:auth-sign-up-flow'
    )
  })

  it('builds schema names within postgres identifier limit', () => {
    const schemaName = buildSchemaName('0194fcff-7108-76e5-a514-288fdb7700d4')
    expect(schemaName.length).toBeLessThanOrEqual(63)
    expect(schemaName.startsWith('test_')).toBe(true)
    expect(schemaName).toContain(compactTestRunId('0194fcff-7108-76e5-a514-288fdb7700d4'))
  })

  it('builds schema-specific database URL with search_path option', () => {
    const url = buildSchemaDatabaseUrl(
      'postgres://postgres:postgres@localhost:5432/tx_agent_kit',
      'test_0194fcff710876e5a514288fdb7700d4'
    )

    expect(url).toContain('options=')
    expect(url).toContain('-csearch_path')
    expect(url).toContain('search_path%3Dtest_0194fcff710876e5a514288fdb7700d4%2Cpublic')
  })

  it('preserves existing connection options while adding search_path', () => {
    const url = buildSchemaDatabaseUrl(
      'postgres://postgres:postgres@localhost:5432/tx_agent_kit?options=-c%20statement_timeout%3D5000',
      'test_0194fcff710876e5a514288fdb7700d4'
    )

    expect(url).toContain('statement_timeout%3D5000')
    expect(url).toContain('search_path%3Dtest_0194fcff710876e5a514288fdb7700d4%2Cpublic')
  })

  it('replaces existing search_path option instead of duplicating it', () => {
    const url = buildSchemaDatabaseUrl(
      'postgres://postgres:postgres@localhost:5432/tx_agent_kit?options=-c%20search_path%3Dlegacy_schema%2Cpublic',
      'test_0194fcff710876e5a514288fdb7700d4'
    )

    expect(url).not.toContain('legacy_schema')
    expect(url).toContain('search_path%3Dtest_0194fcff710876e5a514288fdb7700d4%2Cpublic')
  })
})
