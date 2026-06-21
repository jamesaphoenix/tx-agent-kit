import type { AutoFixRunStatus } from '@tx-agent-kit/contracts'
import { autoFixRunsRepository } from '@tx-agent-kit/db'
import { Effect, Layer, Option } from 'effect'
import {
  AutoFixRunStorePort,
  AutoFixRunStoreTestPort
} from '../ports/auto-fix-run-store-port.js'

/**
 * Live `AutoFixRunStorePort` adapter.
 *
 * Bridges the neutral store port to the `auto_fix_runs` drizzle repository,
 * keeping `@tx-agent-kit/db` out of `apps/api`. Maps the repository's
 * `Option<row>` results to the port's boolean / status / void shapes.
 */
export const AutoFixRunStoreLive = Layer.succeed(AutoFixRunStorePort, {
  insertPendingIfAbsent: (input) =>
    autoFixRunsRepository
      .insertPendingIfAbsent(input)
      .pipe(Effect.map(Option.isSome)),

  getStatusBySentryIssueId: (sentryIssueId) =>
    autoFixRunsRepository
      .getBySentryIssueId(sentryIssueId)
      .pipe(
        Effect.map((row) =>
          Option.match(row, {
            onNone: () => null,
            onSome: (value): AutoFixRunStatus => value.status
          })
        )
      ),

  markDispatched: (sentryIssueId) =>
    autoFixRunsRepository.markDispatched(sentryIssueId)
})

/**
 * Live `AutoFixRunStoreTestPort` adapter (test-only audit seam).
 *
 * Wired only when the env-gated stub trigger is active, so production never
 * provides this layer. Kept separate from `AutoFixRunStoreLive` so the
 * production store port carries no test-only surface.
 */
export const AutoFixRunStoreTestLive = Layer.succeed(AutoFixRunStoreTestPort, {
  recordTriggerCallMarker: (sentryIssueId, marker) =>
    autoFixRunsRepository.appendTriggerCallMarker(sentryIssueId, marker)
})
