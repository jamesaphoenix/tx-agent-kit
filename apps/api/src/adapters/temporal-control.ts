import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError
} from '@temporalio/client'
import {
  AUTO_FIX_TASK_QUEUE,
  AUTO_FIX_WORKFLOW_TYPE,
  type AutoFixWorkflowPayload
} from '@tx-agent-kit/contracts'
import { AutoFixTriggerPort, type AutoFixTriggerError } from '@tx-agent-kit/core'
import { Effect, Layer } from 'effect'
import { getApiTemporalConfig } from '../config/env.js'

// ── API Temporal client (auto-fix trigger ONLY) ─────────────────────
//
// This is the SOLE file in apps/api permitted to import `@temporalio/client`
// (ESLint-exempt). The rest of the platform writes to the transactional outbox
// and lets the worker process events; auto-fix is the one neutral exception
// because the host worker serves a dedicated `auto-fix` queue with no outbox.

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : ''

const withTemporalClient = async <A>(
  operation: (client: Client) => Promise<A>
): Promise<A> => {
  const temporal = getApiTemporalConfig()
  const connection = await Connection.connect(temporal.connectionOptions)
  try {
    const client = new Client({
      connection,
      namespace: temporal.namespace
    })
    return await operation(client)
  } finally {
    await connection.close()
  }
}

const isWorkflowAlreadyStartedError = (error: unknown): boolean => {
  if (error instanceof WorkflowExecutionAlreadyStartedError) {
    return true
  }
  const name = errorName(error).toLowerCase()
  const message = errorMessage(error).toLowerCase()
  return name.includes('alreadystarted') || message.includes('already started')
}

const toAutoFixTriggerError = (error: unknown): AutoFixTriggerError => ({
  _tag: 'Transient',
  retryAfterMs: null,
  reason: errorMessage(error)
})

/**
 * Auto-fix trigger adapter.
 *
 * Starts the host-served `auto-fix` Temporal workflow directly from the API
 * new-issue webhook (no domain outbox).
 *
 * A second webhook for the same issue surfaces Temporal's
 * `WorkflowExecutionAlreadyStartedError`, which we translate to
 * `{ started: false }` (idempotent via the deterministic
 * `auto-fix-<sentryIssueId>` workflowId + `REJECT_DUPLICATE`).
 */
export const AutoFixTriggerLive = Layer.succeed(AutoFixTriggerPort, {
  startAutoFixWorkflow: (input: AutoFixWorkflowPayload) =>
    Effect.tryPromise({
      try: async () => {
        try {
          await withTemporalClient(async (client) => {
            await client.workflow.start(AUTO_FIX_WORKFLOW_TYPE, {
              taskQueue: AUTO_FIX_TASK_QUEUE,
              workflowId: `auto-fix-${input.sentryIssueId}`,
              workflowIdReusePolicy: 'REJECT_DUPLICATE',
              args: [input]
            })
          })
          return { started: true as const }
        } catch (error) {
          if (isWorkflowAlreadyStartedError(error)) {
            return { started: false as const }
          }
          throw error
        }
      },
      catch: toAutoFixTriggerError
    })
})
