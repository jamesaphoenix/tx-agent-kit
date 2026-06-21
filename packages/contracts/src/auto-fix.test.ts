import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import {
  AUTO_FIX_ACTIVITY_TIMEOUT_MS,
  AUTO_FIX_DAILY_QUOTA,
  AUTO_FIX_TASK_QUEUE,
  AUTO_FIX_WORKFLOW_TYPE,
  DEFAULT_AUTO_FIX_AGENT,
  autoFixAgentKinds,
  autoFixEnvironments,
  autoFixOutcomes,
  autoFixResultSchema,
  autoFixRunStatuses,
  autoFixWorkflowPayloadSchema,
  type AutoFixResult,
  type AutoFixWorkflowPayload
} from './index.js'

describe('auto-fix literals', () => {
  it('exposes the expected agent kinds, environments, statuses, outcomes', () => {
    expect(autoFixAgentKinds).toEqual(['codex', 'claude'])
    expect(autoFixEnvironments).toEqual(['staging', 'production'])
    expect(autoFixOutcomes).toEqual(['fixed', 'blocked', 'no_change'])
    expect(autoFixRunStatuses).toEqual([
      'pending',
      'dispatched',
      'running',
      'pr_opened',
      'pushed_no_pr',
      'blocked',
      'failed',
      'rate_limited',
      'skipped'
    ])
  })
})

describe('auto-fix constants', () => {
  it('pins the queue/workflow/agent routing keys', () => {
    expect(AUTO_FIX_WORKFLOW_TYPE).toBe('autoFixRequestedWorkflow')
    expect(AUTO_FIX_TASK_QUEUE).toBe('auto-fix')
    expect(DEFAULT_AUTO_FIX_AGENT).toBe('codex')
  })

  it('pins the quota + activity timeout as positive finite numbers', () => {
    expect(AUTO_FIX_DAILY_QUOTA).toBe(5)
    expect(Number.isFinite(AUTO_FIX_ACTIVITY_TIMEOUT_MS)).toBe(true)
    expect(AUTO_FIX_ACTIVITY_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

describe('autoFixWorkflowPayloadSchema', () => {
  const decode = Schema.decodeUnknownSync(autoFixWorkflowPayloadSchema)

  const valid: AutoFixWorkflowPayload = {
    sentryIssueId: 'ISSUE-123',
    environment: 'staging',
    title: 'TypeError: cannot read property of undefined',
    culprit: 'apps/api/src/routes/foo.ts',
    permalink: 'https://example.test/issues/123/',
    fingerprint: 'fp-abc',
    level: 'error',
    occurredAt: '2026-06-06T00:00:00.000Z'
  }

  it('accepts a complete valid payload', () => {
    expect(decode(valid)).toEqual(valid)
  })

  it('rejects an invalid environment', () => {
    expect(() => decode({ ...valid, environment: 'staging-backup' })).toThrow()
  })

  it('rejects a missing required field', () => {
    const { title: _title, ...withoutTitle } = valid
    expect(() => decode(withoutTitle)).toThrow()
  })
})

describe('autoFixResultSchema', () => {
  const decode = Schema.decodeUnknownSync(autoFixResultSchema)

  const valid: AutoFixResult = {
    outcome: 'fixed',
    summary: 'Patched the null guard',
    rootCause: 'Missing optional chaining',
    prTitle: 'fix: guard against undefined user',
    prBody: 'See incident report',
    filesChanged: ['apps/api/src/routes/foo.ts'],
    testsRun: true,
    testsPassed: true,
    needsManualInput: false,
    blockers: []
  }

  it('accepts a complete valid result', () => {
    expect(decode(valid)).toEqual(valid)
  })

  it('rejects an invalid outcome', () => {
    expect(() => decode({ ...valid, outcome: 'maybe' })).toThrow()
  })
})
