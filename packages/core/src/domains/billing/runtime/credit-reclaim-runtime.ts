import { creditLedgerRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import { makeCreditService as makeCreditServiceBase } from '../application/credit-service.js'
import { StaleReservationReaderPort } from '../ports/credit-reclaim-ports.js'

/**
 * Live wiring for {@link StaleReservationReaderPort}. Bridges the DB
 * repository's `findStaleReservations` query to the port contract.
 *
 * This Layer lives in the `runtime/` layer — NOT `adapters/` — because the
 * public `makeCreditService` factory in the same folder pre-provides it via
 * `Effect.provide(...)` so existing API wiring (`CreditServicePortLive` in
 * `apps/api/src/server-lib.ts`) does not have to supply the new port. The
 * `adapters/` layer cannot be imported by `application/credit-service.ts`;
 * placing this adapter in `runtime/` keeps the layer boundary clean.
 *
 * @spec INV-BILLING-003
 */
export const StaleReservationReaderPortLive = Layer.succeed(StaleReservationReaderPort, {
  findStaleReservations: (input) =>
    creditLedgerRepository.findStaleReservations(input).pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          amountDecimillicents: row.amountDecimillicents,
          referenceId: row.referenceId,
          createdAt: row.createdAt
        }))
      )
    ),
  tryReleaseStaleReservation: (input) =>
    creditLedgerRepository.tryReleaseStaleReservation(input).pipe(
      Effect.map((result) => ({ released: result.released }))
    )
})

/**
 * Public `makeCreditService` factory with the stale-reservation reader
 * pre-provided. Callers (API server, worker) only need to satisfy the same
 * ports the original factory required — the new port is transparent.
 *
 * @spec INV-BILLING-003
 */
export const makeCreditService = makeCreditServiceBase.pipe(
  Effect.provide(StaleReservationReaderPortLive)
)
