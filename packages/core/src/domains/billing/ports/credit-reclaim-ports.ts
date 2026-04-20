import { Context } from 'effect'
import type * as Effect from 'effect/Effect'

/**
 * Required by `scripts/lint/enforce-route-kind-contracts.mjs`. `custom`
 * marks this port as using a bespoke read query rather than the generic
 * CRUD read helpers.
 */
export const CreditReclaimRepositoryKind = 'custom' as const

/**
 * Operational reader for stale reservations.
 *
 * This port exists separately from {@link CreditLedgerStorePort} so the
 * orphan-reservation reclaim workflow can be added without touching the main
 * credit-ledger adapter wiring. The wider system still writes through
 * `CreditLedgerStorePort.append` — the reclaim workflow only needs a
 * read-side scan of ledger rows that have not yet been closed.
 *
 * @spec INV-BILLING-003 — the ledger is immutable, so reclaim appends a
 * `release` row via the normal credit-service path. This port only decides
 * WHICH reserve rows are still open.
 */
export interface StaleReservationRow {
  readonly id: string
  readonly organizationId: string
  readonly amountDecimillicents: number
  readonly referenceId: string | null
  readonly createdAt: Date
}

export class StaleReservationReaderPort extends Context.Tag('StaleReservationReaderPort')<
  StaleReservationReaderPort,
  {
    /**
     * Return reserve rows older than `olderThan` that have no matching close
     * row (`release:<id>`, `finalize:<id>`, or `cancel:<id>`).
     */
    findStaleReservations: (input: {
      olderThan: Date
      limit?: number
    }) => Effect.Effect<ReadonlyArray<StaleReservationRow>, unknown>
    /**
     * Atomically release a stale reserve. Takes an `organizations FOR
     * UPDATE` lock, re-checks the close-row triad
     * (`cancel:<id>` / `release:<id>` / `finalize:<id>`) under the lock,
     * and either decrements `reserved_credits` + inserts the cancel row,
     * or returns `{ released: false }` when a concurrent finalize /
     * release / prior reclaim won the race. The reclaim workflow MUST
     * use this method instead of the generic `creditLedgerStore.append`
     * to avoid the over-release error on race losers.
     *
     * @spec INV-BILLING-003 — concurrent reclaim must be a no-op when
     * the reserve has already been closed by any other path.
     */
    tryReleaseStaleReservation: (input: {
      organizationId: string
      reserveId: string
      amountDecimillicents: number
      reason: string
    }) => Effect.Effect<{ released: boolean }, unknown>
  }
>() {}
