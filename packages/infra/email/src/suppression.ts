import type { Effect } from 'effect';
import { Context } from 'effect'

export interface SuppressionEntry {
  readonly email: string
  readonly reason: 'bounce' | 'complaint' | 'unsubscribe' | 'manual'
  readonly suppressedAt: Date
}

export class SuppressionStorePort extends Context.Tag('SuppressionStorePort')<
  SuppressionStorePort,
  {
    readonly isSuppressed: (email: string) => Effect.Effect<boolean>
    readonly suppress: (entry: SuppressionEntry) => Effect.Effect<void>
    readonly unsuppress: (email: string) => Effect.Effect<void>
    readonly listSuppressed: (options?: {
      readonly reason?: SuppressionEntry['reason']
      readonly limit?: number
      readonly offset?: number
    }) => Effect.Effect<ReadonlyArray<SuppressionEntry>>
  }
>() {}
