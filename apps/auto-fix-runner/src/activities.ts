import { heartbeat } from '@temporalio/activity'
import { Effect } from 'effect'
import {
  AUTO_FIX_ACTIVITY_TIMEOUT_MS,
  AUTO_FIX_DAILY_QUOTA,
  type AutoFixResult,
  type AutoFixRunStatus,
  type AutoFixWorkflowPayload
} from '@tx-agent-kit/contracts'
import { autoFixRunsRepository, type JsonObject } from '@tx-agent-kit/db'
import { createLogger } from '@tx-agent-kit/logging'
import {
  createRedisQuotaLimiter,
  getOrCreateRedisClient,
  type RedisQuotaLimiter
} from '@tx-agent-kit/redis'
import { buildAgentEnv } from './agents/env.js'
import { buildAutoFixPrompt } from './agents/prompt.js'
import { autoFixResultJsonSchema } from './agents/schemas.js'
import { selectAgentRunner } from './agents/select.js'
import type { AgentRunner } from './agents/types.js'
import {
  buildWorktreeToolingEnv,
  getAutoFixRunnerEnv,
  readClaudeAuthCheckEnv,
  readCodexAuthEnv,
  readHostAgentEnv
} from './config/env.js'
import {
  createHostSideEffects,
  type AutoFixSideEffects
} from './side-effects.js'

const logger = createLogger('auto-fix-runner-activities')

const AUTO_FIX_QUOTA_KEY_PREFIX = 'auto-fix-daily-v1'
const AUTO_FIX_QUOTA_KEY = 'global'
const SECONDS_PER_DAY = 86_400

/**
 * Headroom left between the agent's own wall-clock budget and the Temporal
 * activity `startToCloseTimeout` (AUTO_FIX_ACTIVITY_TIMEOUT_MS). The agent's
 * abort timer MUST fire BEFORE Temporal times out the activity: otherwise
 * Temporal abandons the activity (maximumAttempts:1 => failed) while the agent's
 * SIGKILL + the finalize steps (push branch, record run, comment) never
 * complete, leaving the run un-finalized AND the agent process orphaned. This
 * buffer is that finalize window.
 */
const AGENT_FINALIZE_BUFFER_MS = 10 * 60 * 1000
const AGENT_RUN_CEILING_MS = AUTO_FIX_ACTIVITY_TIMEOUT_MS - AGENT_FINALIZE_BUFFER_MS

/**
 * Default agent wall-clock budget when no `AGENT_TIMEOUT_MS` override is set:
 * 25 minutes. A codex hang at ~0% CPU otherwise blocks the single-flight queue
 * for hours; failing fast records the diagnostic and frees the queue. The
 * activity `startToCloseTimeout` is unchanged; only this agent budget default.
 */
const AGENT_RUN_DEFAULT_TIMEOUT_MS = 25 * 60 * 1000

/**
 * How often the activity heartbeats while the agent runs. Temporal's
 * `heartbeatTimeout` (set in the workflow, 1h) is well above this, so a dead
 * worker is detected within the hour instead of after the full 4h
 * `startToCloseTimeout`. Must stay below that heartbeatTimeout.
 */
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000

/**
 * Resolve the agent's wall-clock budget, clamping any `AGENT_TIMEOUT_MS` override
 * to the safe ceiling (activity timeout minus the finalize buffer). An override
 * at/above the activity timeout would re-introduce the orphan/abandon failure
 * mode the buffer exists to prevent, so we cap it rather than trust the operator.
 */
const resolveAgentTimeoutMs = (override: number | undefined): number => {
  const requested = override ?? AGENT_RUN_DEFAULT_TIMEOUT_MS
  if (requested > AGENT_RUN_CEILING_MS) {
    logger.warn('AGENT_TIMEOUT_MS exceeds the safe ceiling, clamping', {
      requestedMs: requested,
      ceilingMs: AGENT_RUN_CEILING_MS,
      activityTimeoutMs: AUTO_FIX_ACTIVITY_TIMEOUT_MS
    })
    return AGENT_RUN_CEILING_MS
  }
  return requested
}

/** Max chars of the codex stderr tail surfaced into the activity result. */
const AGENT_STDERR_TAIL_RESULT_CAP = 4 * 1024

/**
 * Pull the last `limit` human-readable agent message texts out of the parsed
 * codex `--json` event stream. Codex events are loosely shaped (e.g.
 * `{ type: 'item.completed' | 'agent_message', text | message | ... }`), so we
 * read defensively from the known text-bearing fields and ignore everything
 * else. Returns [] when nothing parseable is present.
 */
export const extractLastAgentMessages = (
  items: ReadonlyArray<unknown>,
  limit = 5
): string[] => {
  const texts: string[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const record = item as Record<string, unknown>
    // Prefer the most specific text-bearing fields; codex nests the message
    // text under `item.text` for completed items and `message`/`text` for
    // agent_message events.
    const nested =
      typeof record.item === 'object' && record.item !== null
        ? (record.item as Record<string, unknown>)
        : undefined
    const candidate =
      (typeof record.text === 'string' ? record.text : undefined) ??
      (typeof record.message === 'string' ? record.message : undefined) ??
      (nested && typeof nested.text === 'string' ? nested.text : undefined) ??
      (nested && typeof nested.message === 'string' ? nested.message : undefined)
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      texts.push(candidate)
    }
  }
  return texts.slice(-limit)
}

/**
 * Convert a validated AutoFixResult into a plain JsonObject for persistence
 * (drops the readonly arrays' type identity, keeping the structure intact).
 */
const toJsonObject = (result: AutoFixResult): JsonObject => {
  // AutoFixResult is a flat JSON-safe struct (strings, booleans, string[]);
  // a deep clone produces an equivalent plain object the jsonb column accepts.
  const clone: unknown = structuredClone(result)
  return clone as JsonObject
}

/**
 * Result returned by the auto-fix activity into Temporal history. Beyond the
 * terminal `status` it surfaces lightweight diagnostics so a hung/failed run is
 * legible without opening the DB: the last few agent messages and a tail of the
 * codex stderr (where it stalled).
 */
export interface AutoFixActivityResult {
  readonly status: AutoFixRunStatus
  readonly lastMessages: string[]
  readonly agentStderrTail?: string
}

/**
 * Injected dependencies for {@link runAutoFixAgent}. Defaults wire the real
 * agent runner, Redis quota, host side-effects and DB repository; tests pass
 * fakes so no git/gh/op/HTTP/CLI calls happen.
 */
export interface RunAutoFixAgentDeps {
  readonly enabled: boolean
  readonly agentModel: string | undefined
  /** Branch the fix branches off and the draft PR targets (env knob, default main). */
  readonly baseBranch: string
  /** Agent wall-clock budget (ms). Must stay below the activity startToClose. */
  readonly agentTimeoutMs: number
  readonly runner: AgentRunner
  readonly quota: RedisQuotaLimiter | null
  readonly sideEffects: AutoFixSideEffects
  readonly repository: typeof autoFixRunsRepository
  /** Forwardable host env snapshot for the agent child process. */
  readonly hostEnv: Record<string, string>
  /** Temporal activity heartbeat; injected so tests run without an activity context. */
  readonly heartbeat: () => void
  readonly now: () => Date
}

const resolveDefaultDeps = (): RunAutoFixAgentDeps => {
  const env = getAutoFixRunnerEnv()
  const quota: RedisQuotaLimiter | null = env.REDIS_URL
    ? createRedisQuotaLimiter({
        client: getOrCreateRedisClient({ url: env.REDIS_URL }),
        keyPrefix: AUTO_FIX_QUOTA_KEY_PREFIX,
        points: AUTO_FIX_DAILY_QUOTA,
        durationSeconds: SECONDS_PER_DAY
      })
    : null
  return {
    enabled: env.AUTO_FIX_ENABLED,
    agentModel: env.AGENT_MODEL,
    baseBranch: env.AUTO_FIX_BASE_BRANCH,
    agentTimeoutMs: resolveAgentTimeoutMs(env.AGENT_TIMEOUT_MS),
    runner: selectAgentRunner({
      agent: env.AUTO_FIX_AGENT,
      codexAuthEnv: readCodexAuthEnv(),
      claudeAuthCheckEnv: readClaudeAuthCheckEnv()
    }),
    quota,
    sideEffects: createHostSideEffects(process.cwd(), {
      resolvedEnvDir: env.AUTO_FIX_RESOLVED_ENV_DIR,
      sentryAuthToken: env.SENTRY_AUTH_TOKEN,
      sentryOrgSlug: env.SENTRY_ORG_SLUG,
      worktreeToolingEnv: buildWorktreeToolingEnv()
    }),
    repository: autoFixRunsRepository,
    hostEnv: readHostAgentEnv(),
    heartbeat: () => {
      heartbeat()
    },
    now: () => new Date()
  }
}

/**
 * Derive the terminal `auto_fix_runs.status` from the agent's structured
 * outcome + whether a PR was opened. A clean fix that produced a PR is
 * `pr_opened`; a fix with no PR is `pushed_no_pr`; a blocked agent is `blocked`;
 * anything else (no structured output, error) is `failed`.
 */
export const deriveRunStatus = (
  structured: AutoFixResult | null,
  prOpened: boolean
): AutoFixRunStatus => {
  if (!structured) {
    return 'failed'
  }
  if (structured.outcome === 'blocked') {
    return 'blocked'
  }
  if (structured.outcome === 'fixed' && prOpened) {
    return 'pr_opened'
  }
  return 'pushed_no_pr'
}

/**
 * The single auto-fix Temporal activity (concurrency=1, at most one retry).
 *
 * Order: kill switch -> agent auth -> Redis daily quota -> mark running ->
 * worktree -> render env -> build sanitized agent env -> run agent ->
 * always push branch + (if fixed) open draft PR -> persist agent result +
 * comment back on the source issue. Every terminal path records a row status;
 * it never THROWS on a bug-fix failure (records the status and returns), so a
 * failed/blocked/no-change attempt never triggers a Temporal retry and never
 * burns agent credits twice. The one retry (maximumAttempts:2 in the workflow)
 * only fires on a true infra failure - a worker crash or heartbeat timeout.
 */
const runAutoFixAgentInner = async (
  payload: AutoFixWorkflowPayload,
  deps: RunAutoFixAgentDeps
): Promise<AutoFixActivityResult> => {
  const { sentryIssueId, environment } = payload
  // Worktree/branch names cannot start with a digit (scripts/worktree validate_name
  // rejects `^[0-9]`). Real numeric issue ids must be prefixed; non-numeric ids
  // (tests, e2e fixtures) pass through unchanged.
  const issueRef = /^[0-9]/.test(sentryIssueId) ? `issue-${sentryIssueId}` : sentryIssueId
  const branch = `autofix/${issueRef}`

  if (!deps.enabled) {
    logger.info('Auto-fix disabled; skipping', { sentryIssueId })
    await Effect.runPromise(
      deps.repository.recordAgentResult({
        sentryIssueId,
        status: 'skipped',
        agent: null,
        agentOutput: null,
        agentJsonlOutput: null,
        branch: null,
        prUrl: null,
        agentError: null,
        completedAt: deps.now()
      })
    )
    return { status: 'skipped', lastMessages: [] }
  }

  const auth = await deps.runner.inspectAuth()
  if (auth.status === 'blocked') {
    const agentError = auth.blockers.join('; ')
    logger.error('Agent auth blocked', { sentryIssueId, blockers: auth.blockers })
    await Effect.runPromise(
      deps.repository.recordAgentResult({
        sentryIssueId,
        status: 'blocked',
        agent: deps.runner.kind,
        agentOutput: null,
        agentJsonlOutput: null,
        branch: null,
        prUrl: null,
        agentError,
        completedAt: deps.now()
      })
    )
    return { status: 'blocked', lastMessages: [] }
  }

  if (deps.quota) {
    const decision = await deps.quota.consume(AUTO_FIX_QUOTA_KEY)
    if (!decision.allowed) {
      logger.warn('Auto-fix daily quota exhausted; not retrying', { sentryIssueId })
      await Effect.runPromise(
        deps.repository.recordAgentResult({
          sentryIssueId,
          status: 'rate_limited',
          agent: deps.runner.kind,
          agentOutput: null,
          agentJsonlOutput: null,
          branch: null,
          prUrl: null,
          agentError: null,
          completedAt: deps.now()
        })
      )
      return { status: 'rate_limited', lastMessages: [] }
    }
  }

  await Effect.runPromise(deps.repository.markRunning(sentryIssueId, deps.now()))

  let worktreePath: string
  let renderedEnv: Record<string, string>
  try {
    worktreePath = await deps.sideEffects.createWorktree(branch, deps.baseBranch)
    renderedEnv = await deps.sideEffects.renderEnv(environment)
  } catch (error) {
    const agentError = error instanceof Error ? error.message : String(error)
    logger.error('Auto-fix setup failed', { sentryIssueId, agentError })
    await Effect.runPromise(
      deps.repository.recordAgentResult({
        sentryIssueId,
        status: 'failed',
        agent: deps.runner.kind,
        agentOutput: null,
        agentJsonlOutput: null,
        branch: null,
        prUrl: null,
        agentError,
        completedAt: deps.now()
      })
    )
    return { status: 'failed', lastMessages: [] }
  }

  const agentEnv = buildAgentEnv(deps.runner.kind, renderedEnv, deps.hostEnv)
  const result = await deps.runner.run({
    worktreePath,
    model: deps.agentModel,
    prompt: buildAutoFixPrompt(payload),
    outputSchema: autoFixResultJsonSchema,
    env: agentEnv,
    timeoutMs: deps.agentTimeoutMs
  })

  let committed = false
  let commitError: string | null = null
  let noCommitDiagnostic: string | null = null
  if (result.structured?.outcome === 'fixed') {
    try {
      committed = await deps.sideEffects.commitChanges({
        worktreePath,
        message: result.structured.prTitle,
        body: [
          result.structured.summary,
          '',
          `Root cause: ${result.structured.rootCause}`,
          '',
          `Incident: ${payload.permalink}`
        ].join('\n')
      })
      if (!committed) {
        noCommitDiagnostic = 'Agent reported fixed, but no worktree changes were present to commit.'
        logger.warn('Auto-fix fixed result had no changes to commit', { sentryIssueId })
      }
    } catch (error) {
      commitError = error instanceof Error ? error.message : String(error)
      logger.warn('Auto-fix commit failed', { sentryIssueId, commitError })
    }
  }

  // Push the branch after finalization so committed work is recoverable on any
  // machine. A no-change branch may still push, but it will not open a PR.
  let pushError: string | null = null
  try {
    await deps.sideEffects.pushBranch(worktreePath, branch)
  } catch (error) {
    pushError = error instanceof Error ? error.message : String(error)
    logger.warn('Auto-fix branch push failed', { sentryIssueId, pushError })
  }

  let prUrl: string | null = null
  if (result.structured?.outcome === 'fixed' && committed && pushError === null) {
    try {
      prUrl = await deps.sideEffects.openDraftPr({
        worktreePath,
        baseBranch: deps.baseBranch,
        title: result.structured.prTitle,
        body: `${result.structured.prBody}\n\nIncident: ${payload.permalink}`
      })
    } catch (error) {
      logger.warn('Auto-fix draft PR creation failed', {
        sentryIssueId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const status = deriveRunStatus(result.structured, prUrl !== null)
  const lastMessages = extractLastAgentMessages(result.items)
  const stderrTail = result.stderrTail
    ? result.stderrTail.slice(-AGENT_STDERR_TAIL_RESULT_CAP)
    : undefined

  // When the run produced no usable fix (failed / pushed_no_pr) and we have no
  // explicit error to record, fall back to the codex stderr tail so a
  // hung/killed run that just timed out still records WHERE codex stalled.
  const noStructuredFix = status === 'failed' || status === 'pushed_no_pr'
  const diagnosticFromStderr =
    noStructuredFix && stderrTail ? `Agent produced no fix. codex stderr tail:\n${stderrTail}` : null
  const agentError = result.error ?? commitError ?? pushError ?? noCommitDiagnostic ?? diagnosticFromStderr

  await Effect.runPromise(
    deps.repository.recordAgentResult({
      sentryIssueId,
      status,
      agent: result.agent,
      agentOutput: result.structured ? toJsonObject(result.structured) : null,
      agentJsonlOutput: result.jsonl.length > 0 ? result.jsonl : null,
      branch,
      prUrl,
      agentError: agentError ?? null,
      completedAt: deps.now()
    })
  )

  try {
    const link = prUrl ?? `branch ${branch} pushed to origin`
    await deps.sideEffects.commentOnSentryIssue(
      sentryIssueId,
      `Auto-fix run finished with status ${status}: ${link}`
    )
  } catch (error) {
    logger.warn('Auto-fix comment-back failed', {
      sentryIssueId,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  logger.info('Auto-fix activity completed', { sentryIssueId, status })
  return {
    status,
    lastMessages,
    ...(stderrTail ? { agentStderrTail: stderrTail } : {})
  }
}

/**
 * Temporal activity entrypoint. Wraps the work with a periodic heartbeat (every
 * {@link HEARTBEAT_INTERVAL_MS}) so a dead worker is detected within Temporal's
 * `heartbeatTimeout` instead of after the full `startToCloseTimeout`. The timer
 * is cleared on every exit path (including the early returns + a throw).
 */
export const runAutoFixAgent = async (
  payload: AutoFixWorkflowPayload,
  deps: RunAutoFixAgentDeps = resolveDefaultDeps()
): Promise<AutoFixActivityResult> => {
  const heartbeatTimer = setInterval(() => {
    deps.heartbeat()
  }, HEARTBEAT_INTERVAL_MS)
  try {
    return await runAutoFixAgentInner(payload, deps)
  } finally {
    clearInterval(heartbeatTimer)
  }
}

/** Activity registration map for the Temporal worker. */
export const autoFixActivities = { runAutoFixAgent }
