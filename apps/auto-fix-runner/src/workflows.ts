import { proxyActivities } from '@temporalio/workflow'
// TYPE-ONLY import: a VALUE import from @tx-agent-kit/contracts pulls the contracts
// runtime (effect/Schema) into the workflow bundle, and effect assigns
// `Error.stackTraceLimit` at module load — illegal in the Temporal workflow
// sandbox (WorkflowWorkerUnhandledFailure). Keep the workflow bundle pure.
import type { AutoFixRunStatus, AutoFixWorkflowPayload } from '@tx-agent-kit/contracts'

// Inlined (NOT imported as a contracts value, see above). Mirrors
// AUTO_FIX_ACTIVITY_TIMEOUT_MS in @tx-agent-kit/contracts; keep them in sync.
const ACTIVITY_TIMEOUT_MS = 4 * 60 * 60 * 1000 // 4 hours

// Deterministic workflow: it only proxies the single activity. No wall-clock,
// no randomness, no direct IO.
//
// The activity heartbeats every 30m (see activities.ts); `heartbeatTimeout` (1h,
// > the beat interval) lets Temporal detect a DEAD worker within the hour
// instead of after the full 4h `startToCloseTimeout`.
//
// `maximumAttempts: 2` = at most ONE retry. A logical bug-fix failure
// (no_change/blocked/error) never throws - the activity records a status and
// returns - so it never retries or burns agent credits twice. The one retry
// only fires on a true infra failure (worker crash / heartbeat timeout), so a
// transient death gets one more shot but a failing run can never loop forever.
// Mirrors AutoFixActivityResult in activities.ts. Inlined (not imported) so the
// workflow bundle never pulls the activity module's effect/Schema runtime into
// the Temporal sandbox. Surfaces the agent diagnostics into Temporal history so
// a hung/failed run is legible from the workflow result alone.
interface AutoFixActivityResult {
  readonly status: AutoFixRunStatus
  readonly lastMessages: string[]
  readonly agentStderrTail?: string
}

const { runAutoFixAgent } = proxyActivities<{
  runAutoFixAgent: (payload: AutoFixWorkflowPayload) => Promise<AutoFixActivityResult>
}>({
  startToCloseTimeout: ACTIVITY_TIMEOUT_MS,
  heartbeatTimeout: 60 * 60 * 1000, // 1 hour (> the 30m activity heartbeat interval)
  retry: { maximumAttempts: 2 }
})

/**
 * `autoFixRequestedWorkflow` — started directly by the API (no domain outbox)
 * with a deterministic `auto-fix-<sentryIssueId>` workflowId + REJECT_DUPLICATE.
 * All side effects live in the activity; the workflow just orchestrates.
 */
export async function autoFixRequestedWorkflow(
  payload: AutoFixWorkflowPayload
): Promise<AutoFixActivityResult> {
  return await runAutoFixAgent(payload)
}
