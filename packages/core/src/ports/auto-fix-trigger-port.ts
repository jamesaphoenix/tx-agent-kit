/**
 * Auto-fix workflow trigger seam.
 *
 * Platform-level port for starting the auto-fix workflow from the API
 * new-issue webhook (not part of any domain logic). It keeps the domain
 * outbox (`domain_events`) business-only and shields it from incident
 * webhook volume.
 *
 * Located at core's cross-cutting `ports/` folder (neutral, non-domain), so
 * auto-fix never couples to a business domain.
 */

import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { AutoFixWorkflowPayload } from '@tx-agent-kit/contracts'

/**
 * Discriminated error union for auto-fix trigger operations.
 *
 * Note: a second webhook for the same issue is NOT modelled as an error.
 * `startAutoFixWorkflow` returns `{ started: false }` in that case (idempotent
 * via the deterministic `workflowId`), because the workflow is already running
 * -- a no-op success. Errors here are reserved for genuine transport/structural
 * failures.
 */
export type AutoFixTriggerError =
  | {
      readonly _tag: 'Transient'
      readonly retryAfterMs: number | null
      readonly reason: string
    }
  | {
      readonly _tag: 'Permanent'
      readonly code: string
      readonly message: string
    }

/**
 * Trigger seam for starting the auto-fix workflow from the API webhook.
 *
 * Wraps the Temporal client. This seam exists so the API webhook handler
 * depends on the capability via DI and does NOT import `@temporalio/*`
 * directly -- only `apps/api/src/adapters/temporal-control.ts` is
 * ESLint-exempted to do that.
 */
export class AutoFixTriggerPort extends Context.Tag('AutoFixTriggerPort')<
  AutoFixTriggerPort,
  {
    /**
     * Start an auto-fix workflow for a new issue.
     *
     * Returns `{ started: true }` when a fresh workflow was started.
     *
     * Returns `{ started: false }` when a workflow for this issue is
     * already in flight (the adapter translates Temporal's
     * `WorkflowExecutionAlreadyStartedError`; idempotent via the
     * deterministic `auto-fix-<sentryIssueId>` workflowId). Callers treat
     * this as a no-op success, not an error.
     *
     * Fails with `AutoFixTriggerError` for genuinely transient (Temporal
     * unreachable) or permanent (structural) failures.
     */
    readonly startAutoFixWorkflow: (
      input: AutoFixWorkflowPayload
    ) => Effect.Effect<{ readonly started: boolean }, AutoFixTriggerError>
  }
>() {}
