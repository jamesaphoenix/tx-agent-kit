import { eq, sql } from 'drizzle-orm'
import type {
  AutoFixAgentKind,
  AutoFixEnvironment,
  AutoFixRunStatus
} from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { autoFixRunRowSchema } from '../effect-schemas/auto-fix-runs.js'
import { autoFixRuns, type JsonObject } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(autoFixRunRowSchema, 'auto fix run row')

/**
 * Repository for the `auto_fix_runs` operational table.
 *
 * Keeps drizzle-orm contained inside `packages/infra/db` (the API webhook
 * handler depends on this repository, never on drizzle directly). The
 * unique index on `sentry_issue_id` is both the once-per-issue guarantee
 * and the webhook dedupe key.
 */
export const autoFixRunsRepository = {
  /**
   * Dedupe insert: insert a `pending` row only if no row for this
   * `sentry_issue_id` already exists (`ON CONFLICT DO NOTHING`).
   *
   * Returns `Option.some(row)` when a fresh row was inserted (genuinely new
   * issue) and `Option.none()` when the row already existed (duplicate
   * webhook). The caller uses the presence to decide whether to start the
   * Temporal workflow.
   */
  insertPendingIfAbsent: (input: {
    sentryIssueId: string
    environment: AutoFixEnvironment
    title: string
    fingerprint: string | null
    permalink: string | null
  }) =>
    withDb('Failed to insert auto fix run', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(autoFixRuns)
          .values({
            sentryIssueId: input.sentryIssueId,
            environment: input.environment,
            title: input.title,
            fingerprint: input.fingerprint,
            permalink: input.permalink,
            status: 'pending'
          })
          .onConflictDoNothing({ target: autoFixRuns.sentryIssueId })
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  /** Read the current row for an issue (used to inspect status on a duplicate). */
  getBySentryIssueId: (sentryIssueId: string) =>
    withDb('Failed to read auto fix run', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(autoFixRuns)
          .where(eq(autoFixRuns.sentryIssueId, sentryIssueId))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  /** Mark a run as `dispatched` after the workflow start succeeded. */
  markDispatched: (sentryIssueId: string) =>
    withDb('Failed to mark auto fix run dispatched', (db) =>
      Effect.gen(function* () {
        yield* db
          .update(autoFixRuns)
          .set({ status: 'dispatched' })
          .where(eq(autoFixRuns.sentryIssueId, sentryIssueId))
          .execute()
      })
    ),

  /**
   * Mark a run as `running` and stamp `started_at` when the host worker's
   * `runAutoFixAgent` activity begins. Idempotent: re-running the activity
   * (Temporal redelivery) simply re-sets the same fields.
   */
  markRunning: (sentryIssueId: string, startedAt: Date) =>
    withDb('Failed to mark auto fix run running', (db) =>
      Effect.gen(function* () {
        yield* db
          .update(autoFixRuns)
          .set({ status: 'running', startedAt })
          .where(eq(autoFixRuns.sentryIssueId, sentryIssueId))
          .execute()
      })
    ),

  /**
   * Persist the terminal result of an auto-fix agent run: which agent ran,
   * its structured `agent_output` (the parsed AutoFixResult), the raw
   * `agent_jsonl_output` stream for audit, the pushed branch + PR URL, any
   * error, and the final status. Stored per `sentry_issue_id`.
   */
  recordAgentResult: (input: {
    sentryIssueId: string
    status: AutoFixRunStatus
    agent: AutoFixAgentKind | null
    agentOutput: JsonObject | null
    agentJsonlOutput: string | null
    branch: string | null
    prUrl: string | null
    agentError: string | null
    completedAt: Date
  }) =>
    withDb('Failed to record auto fix agent result', (db) =>
      Effect.gen(function* () {
        yield* db
          .update(autoFixRuns)
          .set({
            status: input.status,
            agent: input.agent,
            agentOutput: input.agentOutput,
            agentJsonlOutput: input.agentJsonlOutput,
            branch: input.branch,
            prUrl: input.prUrl,
            agentError: input.agentError,
            completedAt: input.completedAt
          })
          .where(eq(autoFixRuns.sentryIssueId, input.sentryIssueId))
          .execute()
      })
    ),

  /**
   * Test-only audit hook: append a marker to `agent_jsonl_output` so an
   * integration test (which talks to the spawned API only over HTTP) can
   * count, via SQL, how many times the trigger seam was invoked for an issue.
   * Production code never calls this; only the env-gated stub trigger adapter
   * does. Kept on the repository so drizzle stays inside this package.
   */
  appendTriggerCallMarker: (sentryIssueId: string, marker: string) =>
    withDb('Failed to append auto fix trigger marker', (db) =>
      Effect.gen(function* () {
        yield* db
          .update(autoFixRuns)
          .set({
            agentJsonlOutput: sql`coalesce(${autoFixRuns.agentJsonlOutput}, '') || ${marker}`
          })
          .where(eq(autoFixRuns.sentryIssueId, sentryIssueId))
          .execute()
      })
    )
}
