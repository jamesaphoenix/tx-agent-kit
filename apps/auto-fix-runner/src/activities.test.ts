import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import type {
  AutoFixResult,
  AutoFixRunStatus,
  AutoFixWorkflowPayload
} from '@tx-agent-kit/contracts'
import { autoFixRunsRepository } from '@tx-agent-kit/db'
import type { RedisQuotaDecision } from '@tx-agent-kit/redis'
import {
  deriveRunStatus,
  extractLastAgentMessages,
  runAutoFixAgent,
  type RunAutoFixAgentDeps
} from './activities.js'
import type { AutoFixSideEffects } from './side-effects.js'
import type { AgentAuthCheck, AgentRunResult, AgentRunner } from './agents/types.js'

// ── Test doubles ─────────────────────────────────────────────────────
//
// Every dependency of runAutoFixAgent is faked here: no real git/gh/op/Redis
// or agent CLI is touched. recordAgentResult / markRunning calls are captured
// into a shared log so each terminal path can be asserted.

interface RecordedResult {
  readonly sentryIssueId: string
  readonly status: AutoFixRunStatus
  readonly agent: string | null
  readonly branch: string | null
  readonly prUrl: string | null
  readonly agentError: string | null
}

interface CaptureLog {
  readonly recorded: RecordedResult[]
  readonly running: string[]
}

const samplePayload: AutoFixWorkflowPayload = {
  sentryIssueId: 'ISSUE-1',
  environment: 'staging',
  title: 'TypeError: undefined is not a function',
  culprit: 'apps/api/src/handler.ts',
  permalink: 'https://example.test/issues/ISSUE-1/',
  fingerprint: 'fp-1',
  level: 'error',
  occurredAt: '2026-06-06T00:00:00.000Z'
}

const fixedResult: AutoFixResult = {
  outcome: 'fixed',
  summary: 'Guarded the undefined call.',
  rootCause: 'Missing null check.',
  prTitle: 'fix: guard undefined call',
  prBody: 'Adds a null check before invoking the handler.',
  filesChanged: ['apps/api/src/handler.ts'],
  testsRun: true,
  testsPassed: true,
  needsManualInput: false,
  blockers: []
}

/**
 * Build a fake repository that satisfies `typeof autoFixRunsRepository` by
 * spreading the real object and overriding only the two methods the activity
 * uses on the happy/terminal paths. The unused query methods keep their real
 * (never-invoked) signatures so the structural type matches without casts.
 */
const createFakeRepository = (log: CaptureLog): typeof autoFixRunsRepository => ({
  ...autoFixRunsRepository,
  markRunning: (sentryIssueId: string) =>
    Effect.sync(() => {
      log.running.push(sentryIssueId)
    }),
  recordAgentResult: (input: {
    sentryIssueId: string
    status: AutoFixRunStatus
    agent: string | null
    branch: string | null
    prUrl: string | null
    agentError: string | null
  }) =>
    Effect.sync(() => {
      log.recorded.push({
        sentryIssueId: input.sentryIssueId,
        status: input.status,
        agent: input.agent,
        branch: input.branch,
        prUrl: input.prUrl,
        agentError: input.agentError
      })
    })
})

const okAuth: AgentAuthCheck = { status: 'ok', blockers: [] }

const createFakeRunner = (overrides: {
  auth?: AgentAuthCheck
  result?: AgentRunResult
}): AgentRunner => ({
  kind: 'codex',
  inspectAuth: () => Promise.resolve(overrides.auth ?? okAuth),
  run: () =>
    Promise.resolve(
      overrides.result ?? {
        agent: 'codex',
        structured: fixedResult,
        jsonl: '{"type":"item"}\n',
        items: [],
        exitCode: 0
      }
    )
})

const noopSideEffects = (overrides: Partial<AutoFixSideEffects> = {}): AutoFixSideEffects => ({
  createWorktree: () => Promise.resolve('/wt/autofix-ISSUE-1'),
  renderEnv: () => Promise.resolve({}),
  commitChanges: () => Promise.resolve(true),
  pushBranch: () => Promise.resolve(),
  openDraftPr: () => Promise.resolve('https://github.com/org/repo/pull/1'),
  commentOnSentryIssue: () => Promise.resolve(),
  ...overrides
})

const allowedDecision: RedisQuotaDecision = {
  allowed: true,
  remaining: 9,
  retryAfterSeconds: 0,
  resetAtMs: null
}

const baseDeps = (
  log: CaptureLog,
  overrides: Partial<RunAutoFixAgentDeps> = {}
): RunAutoFixAgentDeps => ({
  enabled: true,
  agentModel: 'gpt-5-codex',
  baseBranch: 'main',
  agentTimeoutMs: 30 * 60 * 1000,
  runner: createFakeRunner({}),
  quota: null,
  sideEffects: noopSideEffects(),
  repository: createFakeRepository(log),
  hostEnv: {},
  heartbeat: () => {},
  now: () => new Date('2026-06-06T00:00:00.000Z'),
  ...overrides
})

const newLog = (): CaptureLog => ({ recorded: [], running: [] })

describe('runAutoFixAgent', () => {
  it('heartbeats every 30m while the agent runs and stops once it completes', async () => {
    vi.useFakeTimers()
    try {
      const log = newLog()
      let resolveRun: (r: AgentRunResult) => void = () => {}
      const slowRunner: AgentRunner = {
        kind: 'codex',
        inspectAuth: () => Promise.resolve(okAuth),
        run: () =>
          new Promise<AgentRunResult>((resolve) => {
            resolveRun = resolve
          })
      }
      let beats = 0
      const deps = baseDeps(log, {
        runner: slowRunner,
        heartbeat: () => {
          beats += 1
        }
      })
      const activity = runAutoFixAgent(samplePayload, deps)
      // Pre-run steps settle as microtasks, then the 30m interval fires.
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(beats).toBe(1)
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(beats).toBe(2)
      resolveRun({ agent: 'codex', structured: fixedResult, jsonl: '', items: [], exitCode: 0 })
      await activity
      // Timer is cleared on completion: advancing further produces no more beats.
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
      expect(beats).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records skipped without touching the runner when the kill switch is off', async () => {
    const log = newLog()
    const result = await runAutoFixAgent(samplePayload, baseDeps(log, { enabled: false }))

    expect(result.status).toBe('skipped')
    expect(log.recorded).toHaveLength(1)
    expect(log.recorded[0]?.status).toBe('skipped')
    expect(log.running).toHaveLength(0)
  })

  it('records blocked when agent auth is blocked', async () => {
    const log = newLog()
    const deps = baseDeps(log, {
      runner: createFakeRunner({
        auth: { status: 'blocked', blockers: ['Codex auth file is missing'] }
      })
    })

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('blocked')
    expect(log.recorded[0]?.status).toBe('blocked')
    expect(log.recorded[0]?.agentError).toContain('Codex auth file is missing')
    expect(log.running).toHaveLength(0)
  })

  it('records rate_limited when the daily quota is denied', async () => {
    const log = newLog()
    const deps = baseDeps(log, {
      quota: {
        consume: () =>
          Promise.resolve({ ...allowedDecision, allowed: false, remaining: 0 }),
        delete: () => Promise.resolve(true)
      }
    })

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('rate_limited')
    expect(log.recorded[0]?.status).toBe('rate_limited')
    expect(log.running).toHaveLength(0)
  })

  it('records failed when worktree setup throws', async () => {
    const log = newLog()
    const deps = baseDeps(log, {
      sideEffects: noopSideEffects({
        createWorktree: () => Promise.reject(new Error('create.sh exited with 1'))
      })
    })

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('failed')
    expect(log.running).toEqual(['ISSUE-1'])
    expect(log.recorded[0]?.status).toBe('failed')
    expect(log.recorded[0]?.agentError).toContain('create.sh exited with 1')
  })

  it('records pr_opened when the agent fixes and the PR opens', async () => {
    const log = newLog()
    const deps = baseDeps(log)

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('pr_opened')
    expect(log.running).toEqual(['ISSUE-1'])
    const recorded = log.recorded[0]
    expect(recorded?.status).toBe('pr_opened')
    expect(recorded?.branch).toBe('autofix/ISSUE-1')
    expect(recorded?.prUrl).toBe('https://github.com/org/repo/pull/1')
    expect(recorded?.agent).toBe('codex')
  })

  it('branches the worktree + targets the PR at the configured base branch', async () => {
    const log = newLog()
    let createdBase: string | null = null
    let prBase: string | null = null
    const deps = baseDeps(log, {
      baseBranch: 'staging',
      sideEffects: noopSideEffects({
        createWorktree: (_branch: string, base: string) => {
          createdBase = base
          return Promise.resolve('/wt/autofix-ISSUE-1')
        },
        openDraftPr: ({ baseBranch }) => {
          prBase = baseBranch
          return Promise.resolve('https://github.com/org/repo/pull/1')
        }
      })
    })

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('pr_opened')
    expect(createdBase).toBe('staging')
    expect(prBase).toBe('staging')
  })

  it('commits fixed changes before pushing and opening a draft PR', async () => {
    const log = newLog()
    const calls: string[] = []
    const deps = baseDeps(log, {
      sideEffects: noopSideEffects({
        commitChanges: () => {
          calls.push('commit')
          return Promise.resolve(true)
        },
        pushBranch: () => {
          calls.push('push')
          return Promise.resolve()
        },
        openDraftPr: () => {
          calls.push('pr')
          return Promise.resolve('https://github.com/org/repo/pull/1')
        }
      })
    })

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('pr_opened')
    expect(calls).toEqual(['commit', 'push', 'pr'])
  })

  it('records pushed_no_pr when a fixed result has no changes to commit', async () => {
    const log = newLog()
    const openedPr = vi.fn<AutoFixSideEffects['openDraftPr']>()
    const deps = baseDeps(log, {
      sideEffects: noopSideEffects({
        commitChanges: () => Promise.resolve(false),
        openDraftPr: openedPr
      })
    })

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('pushed_no_pr')
    expect(openedPr).not.toHaveBeenCalled()
    const recorded = log.recorded[0]
    expect(recorded?.status).toBe('pushed_no_pr')
    expect(recorded?.agentError).toContain('no worktree changes were present')
  })

  it('prefixes a numeric issue id so the worktree/branch name is valid (regression)', async () => {
    // scripts/worktree validate_name rejects names starting with a digit, so a raw
    // numeric id (e.g. 126211025) must become `autofix/issue-126211025`.
    // Without the prefix the run dies at create.sh before the agent ever spawns.
    const log = newLog()
    let createdBranch: string | null = null
    const deps = baseDeps(log, {
      sideEffects: noopSideEffects({
        createWorktree: (branch: string) => {
          createdBranch = branch
          return Promise.resolve(`/wt/${branch.slice(branch.lastIndexOf('/') + 1)}`)
        }
      })
    })

    const result = await runAutoFixAgent(
      { ...samplePayload, sentryIssueId: '126211025' },
      deps
    )

    expect(result.status).toBe('pr_opened')
    expect(createdBranch).toBe('autofix/issue-126211025')
    expect(log.recorded[0]?.branch).toBe('autofix/issue-126211025')
  })

  it('surfaces the last agent messages in the activity result for Temporal history', async () => {
    const log = newLog()
    const deps = baseDeps(log, {
      runner: createFakeRunner({
        result: {
          agent: 'codex',
          structured: fixedResult,
          jsonl: '',
          items: [
            { type: 'item.completed', item: { text: 'reading apps/api/src/handler.ts' } },
            { type: 'agent_message', message: 'applied null guard' }
          ],
          exitCode: 0
        }
      })
    })

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('pr_opened')
    expect(result.lastMessages).toEqual([
      'reading apps/api/src/handler.ts',
      'applied null guard'
    ])
  })

  it('falls back to the codex stderr tail for agentError when a failed run produced no fix', async () => {
    const log = newLog()
    const deps = baseDeps(log, {
      runner: createFakeRunner({
        result: {
          agent: 'codex',
          structured: null,
          jsonl: '',
          items: [],
          exitCode: null,
          stderrTail: 'TRACE codex_core: blocked waiting on MCP startup'
        }
      })
    })

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('failed')
    expect(result.agentStderrTail).toContain('blocked waiting on MCP startup')
    const recorded = log.recorded[0]
    expect(recorded?.status).toBe('failed')
    expect(recorded?.agentError).toContain('blocked waiting on MCP startup')
  })

  it('records pushed_no_pr when the agent fixes but the push fails', async () => {
    const log = newLog()
    const deps = baseDeps(log, {
      sideEffects: noopSideEffects({
        pushBranch: () => Promise.reject(new Error('git push rejected'))
      })
    })

    const result = await runAutoFixAgent(samplePayload, deps)

    expect(result.status).toBe('pushed_no_pr')
    const recorded = log.recorded[0]
    expect(recorded?.status).toBe('pushed_no_pr')
    expect(recorded?.prUrl).toBeNull()
    expect(recorded?.agentError).toContain('git push rejected')
  })
})

describe('deriveRunStatus', () => {
  it('returns failed when there is no structured output', () => {
    expect(deriveRunStatus(null, false)).toBe('failed')
    expect(deriveRunStatus(null, true)).toBe('failed')
  })

  it('returns blocked when the agent reports blocked', () => {
    expect(deriveRunStatus({ ...fixedResult, outcome: 'blocked' }, false)).toBe('blocked')
  })

  it('returns pr_opened only when fixed and a PR was opened', () => {
    expect(deriveRunStatus(fixedResult, true)).toBe('pr_opened')
  })

  it('returns pushed_no_pr when fixed but no PR opened', () => {
    expect(deriveRunStatus(fixedResult, false)).toBe('pushed_no_pr')
  })

  it('returns pushed_no_pr for a no_change outcome', () => {
    expect(deriveRunStatus({ ...fixedResult, outcome: 'no_change' }, false)).toBe('pushed_no_pr')
  })
})

describe('extractLastAgentMessages', () => {
  it('returns the last N human-readable texts from codex --json items', () => {
    const items = [
      { type: 'item.completed', item: { text: 'msg-1' } },
      { type: 'agent_message', message: 'msg-2' },
      { type: 'item.completed', text: 'msg-3' },
      { type: 'agent_message', message: 'msg-4' }
    ]
    expect(extractLastAgentMessages(items, 2)).toEqual(['msg-3', 'msg-4'])
  })

  it('defaults to the last 5 texts', () => {
    const items = Array.from({ length: 8 }, (_value, index) => ({
      type: 'agent_message',
      message: `m${index}`
    }))
    expect(extractLastAgentMessages(items)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7'])
  })

  it('ignores non-text / non-object items defensively and returns [] when nothing parseable', () => {
    expect(extractLastAgentMessages([])).toEqual([])
    expect(extractLastAgentMessages([null, 42, 'raw', { type: 'token_count', tokens: 10 }])).toEqual(
      []
    )
    // Blank/whitespace-only texts are skipped.
    expect(extractLastAgentMessages([{ type: 'agent_message', message: '   ' }])).toEqual([])
  })
})
