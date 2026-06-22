import { createLogger } from '@tx-agent-kit/logging'
import { Effect } from 'effect'

/** Shared logger for the lifecycle/campaign activities. */
export const logger = createLogger('tx-agent-kit-worker-lifecycle')

/**
 * Run an Effect to a Promise, remapping any failure into a plain Error so a
 * Temporal activity surfaces a real stack instead of an opaque Effect failure.
 * Used by every lifecycle/campaign activity that talks to a repository.
 */
export const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )
