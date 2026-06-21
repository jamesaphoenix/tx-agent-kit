import type { AutoFixWorkflowPayload } from '@tx-agent-kit/contracts'
import {
  AutoFixRunStoreTestPort,
  AutoFixTriggerPort,
  type AutoFixTriggerError
} from '@tx-agent-kit/core'
import { Effect, Layer } from 'effect'

/**
 * Test-only `AutoFixTriggerPort` implementation.
 *
 * Wired in place of the live Temporal-backed adapter when
 * `AUTO_FIX_TRIGGER_MODE=stub` (see `isAutoFixTriggerStubMode`). It never talks
 * to Temporal; instead it RECORDS each `startAutoFixWorkflow` call (via the
 * test-only `AutoFixRunStoreTestPort` audit hook) by appending a marker to the
 * run's `agent_jsonl_output` column. The webhook integration test (which talks
 * to the spawned API only over HTTP) counts those markers via SQL to assert
 * "exactly one start call per new issue" and "no second start on a duplicate".
 *
 * Failure injection: a payload whose `sentryIssueId` starts with
 * `transient-` resolves to a `Transient` trigger error WITHOUT recording a
 * marker, so the test can exercise the 5xx-retry path and confirm the row stays
 * `pending`.
 *
 * Depends on `AutoFixRunStoreTestPort` (not `@tx-agent-kit/db`) so it stays a
 * valid external-style adapter in `apps/api/src/adapters/`.
 */
export const AUTO_FIX_STUB_TRANSIENT_PREFIX = 'transient-'

/** Marker appended once per recorded trigger call (one char = one call). */
export const AUTO_FIX_STUB_CALL_MARKER = 'X'

export const AutoFixTriggerStubLive = Layer.effect(
  AutoFixTriggerPort,
  Effect.gen(function* () {
    const store = yield* AutoFixRunStoreTestPort

    return {
      startAutoFixWorkflow: (
        input: AutoFixWorkflowPayload
      ): Effect.Effect<{ readonly started: boolean }, AutoFixTriggerError> => {
        if (input.sentryIssueId.startsWith(AUTO_FIX_STUB_TRANSIENT_PREFIX)) {
          const transient: AutoFixTriggerError = {
            _tag: 'Transient',
            retryAfterMs: null,
            reason: 'stub: injected transient error'
          }
          return Effect.fail(transient)
        }

        return store
          .recordTriggerCallMarker(input.sentryIssueId, AUTO_FIX_STUB_CALL_MARKER)
          .pipe(
            Effect.as({ started: true as const }),
            Effect.mapError(
              (error): AutoFixTriggerError => ({
                _tag: 'Transient',
                retryAfterMs: null,
                reason: error instanceof Error ? error.message : String(error)
              })
            )
          )
      }
    }
  })
)
