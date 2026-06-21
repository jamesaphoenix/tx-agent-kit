/**
 * Auto-fix run persistence seam.
 *
 * Platform-level (non-domain) port for the `auto_fix_runs` operational table.
 * The API new-issue webhook handler depends on this port via DI so the route
 * never imports `@tx-agent-kit/db` directly. Deliberately neutral (lives in
 * core's cross-cutting `ports/` folder) because auto-fix is operational infra,
 * not a business domain.
 */

import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { AutoFixEnvironment, AutoFixRunStatus } from '@tx-agent-kit/contracts'

export interface InsertAutoFixRunInput {
  readonly sentryIssueId: string
  readonly environment: AutoFixEnvironment
  readonly title: string
  readonly fingerprint: string | null
  readonly permalink: string | null
}

export class AutoFixRunStorePort extends Context.Tag('AutoFixRunStorePort')<
  AutoFixRunStorePort,
  {
    /**
     * Dedupe insert (INSERT ... ON CONFLICT (sentry_issue_id) DO NOTHING).
     * Returns `true` when a fresh `pending` row was inserted (genuinely new
     * issue) and `false` when a row already existed (duplicate webhook).
     */
    readonly insertPendingIfAbsent: (
      input: InsertAutoFixRunInput
    ) => Effect.Effect<boolean, unknown>

    /** Read the current status for an issue, or null when no row exists. */
    readonly getStatusBySentryIssueId: (
      sentryIssueId: string
    ) => Effect.Effect<AutoFixRunStatus | null, unknown>

    /** Mark a run as `dispatched` after the workflow start succeeded. */
    readonly markDispatched: (
      sentryIssueId: string
    ) => Effect.Effect<void, unknown>
  }
>() {}

/**
 * Test-only audit seam, intentionally separate from the production
 * `AutoFixRunStorePort`. Only the env-gated stub trigger adapter and the
 * webhook integration test depend on this; production wiring never references
 * it, so the production port stays free of test-only surface.
 */
export class AutoFixRunStoreTestPort extends Context.Tag('AutoFixRunStoreTestPort')<
  AutoFixRunStoreTestPort,
  {
    /**
     * Append a marker to the run's audit column so an integration test can
     * count trigger invocations per issue via SQL.
     */
    readonly recordTriggerCallMarker: (
      sentryIssueId: string,
      marker: string
    ) => Effect.Effect<void, unknown>
  }
>() {}
