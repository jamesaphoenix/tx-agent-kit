import { Effect, Option } from 'effect'
import { internalError, notFound, paymentRequired, type CoreError } from '../../../errors.js'
import { CreditLedgerStorePort, BillingStorePort } from '../ports/billing-ports.js'
import { StaleReservationReaderPort } from '../ports/credit-reclaim-ports.js'
import type { JsonObject } from '../domain/billing-domain.js'

/** Map store errors: insufficient credits → 402, everything else → 500. */
const mapCreditError = (error: unknown): CoreError => {
  const msg = error instanceof Error ? error.message : String(error)
  if (msg.includes('Insufficient') || msg.includes('Over-release')) {
    return paymentRequired(msg)
  }
  return internalError(`Credit operation failed: ${msg}`)
}

const isSafeNonNegativeInteger = (value: number): boolean =>
  Number.isFinite(value)
  && Number.isInteger(value)
  && Number.isSafeInteger(value)
  && value >= 0

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isFinite(value)
  && Number.isInteger(value)
  && Number.isSafeInteger(value)
  && value > 0

/**
 * Internal factory that still requires {@link StaleReservationReaderPort} in
 * its Effect context. The public, pre-wired factory lives in the `runtime/`
 * layer so the adapter import does not leak into the application layer — see
 * `../runtime/credit-reclaim-runtime.ts`.
 */
export const makeCreditService = Effect.gen(function* () {
  const billingStore = yield* BillingStorePort
  const creditLedgerStore = yield* CreditLedgerStorePort
  const staleReservationReader = yield* StaleReservationReaderPort

  /** Read available balance after a mutation. */
  const readAvailable = (organizationId: string) =>
    billingStore.getSubscriptionFields(organizationId).pipe(
      Effect.map((maybeSettings) =>
        Option.match(maybeSettings, {
          onNone: () => 0,
          onSome: (settings) => settings.creditsBalance - settings.reservedCredits
        })
      ),
      Effect.mapError((error) => internalError(`Failed to read balance: ${error instanceof Error ? error.message : String(error)}`))
    )

  return {
    /**
     * Atomically reserve credits for an in-flight async operation.
     * Increases `reservedCredits` — does NOT debit `creditsBalance`.
     * Fails with 402 if available balance (creditsBalance - reservedCredits) < cost.
     */
    reserve: (input: {
      organizationId: string
      estimatedCostDecimillicents: number
      referenceId: string
      reason: string
    }): Effect.Effect<{ reservationId: string; remainingBalance: number }, CoreError> =>
      Effect.gen(function* () {
        // Defensive validation — same shape as finalize / creditsPurchased.
        // A bad reserve amount lands directly on the immutable ledger
        // and the `reserved_credits` accounting column.
        if (!isSafeNonNegativeInteger(input.estimatedCostDecimillicents)) {
          return yield* Effect.fail(internalError(
            `reserve: estimatedCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.estimatedCostDecimillicents)}`
          ))
        }

        // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
        // Suspended orgs (usage cap exceeded or open dispute) cannot reserve
        // credits until creditPositiveReevaluate clears the flag.
        //
        // The suspension check happens INSIDE the ledger append transaction
        // under the FOR UPDATE lock (via `failIfSuspended`), not as a
        // separate unscoped SELECT above. Under load, a setSuspended that
        // fired between a pre-lock check and the append acquisition would
        // let one more op slip through — moving the check under the lock
        // closes that TOCTOU window. @spec INV-BILLING-003
        const entry = yield* creditLedgerStore.append({
          organizationId: input.organizationId,
          entryType: 'reserve',
          amountDecimillicents: input.estimatedCostDecimillicents,
          reason: input.reason,
          referenceId: input.referenceId,
          failIfSuspended: true
        }).pipe(
          Effect.mapError((error) => {
            const message = error instanceof Error ? error.message : String(error)
            if (message.includes('Organization is suspended')) {
              return paymentRequired('Organization is suspended — top up to resume operations')
            }
            return mapCreditError(error)
          })
        )

        const available = yield* readAvailable(input.organizationId)
        return { reservationId: entry.id, remainingBalance: available }
      }),

    /**
     * Finalize a reservation: release hold and debit actual cost.
     * Atomic: release + debit + (conditional low-balance outbox event) in a
     * single transaction.
     *
     * @spec INV-BILLING-009 — if the org has auto-recharge configured and
     * the new available balance drops below `autoRechargeThreshold`, the
     * credit-ledger repo commits a `billing.credits_low_balance` domain
     * event in the same transaction as the debit.
     */
    finalize: (input: {
      organizationId: string
      reservationId: string
      estimatedCostDecimillicents: number
      actualCostDecimillicents: number
      marginMultiplier: number
      assetId?: string | null
      phase?: string | null
      metadata?: JsonObject
    }): Effect.Effect<{ finalCostDecimillicents: number; remainingBalance: number }, CoreError> =>
      Effect.gen(function* () {
        // Defensive validation at the service seam — same shape as the
        // createCostResult hardening in @tx-agent-kit/contracts. Every
        // failure mode here is a money-loss vector if it slips through
        // to the ledger:
        //   - actualCostDecimillicents NaN / Infinity → finalCost NaN →
        //     bigint cast fails OR (worse) Postgres truncates the
        //     debit to 0 silently (depending on driver).
        //   - actualCostDecimillicents < 0 → flips the sign, the org
        //     gets credits for finishing an op.
        //   - actualCostDecimillicents non-integer → the multiplication
        //     introduces float artifacts in the bigint ledger column.
        //   - marginMultiplier < 1 → discounts the customer below cost.
        //   - marginMultiplier NaN / Infinity → finalCost garbage.
        // estimatedCostDecimillicents is similarly guarded — the repo's
        // releaseReservation path enforces non-negative for releaseAmount
        // but doesn't reject NaN or fractional values.
        if (!isSafeNonNegativeInteger(input.actualCostDecimillicents)) {
          return yield* Effect.fail(internalError(
            `finalize: actualCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.actualCostDecimillicents)}`
          ))
        }
        if (!isSafeNonNegativeInteger(input.estimatedCostDecimillicents)) {
          return yield* Effect.fail(internalError(
            `finalize: estimatedCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.estimatedCostDecimillicents)}`
          ))
        }
        if (
          !Number.isFinite(input.marginMultiplier)
          || input.marginMultiplier < 1
        ) {
          return yield* Effect.fail(internalError(
            `finalize: marginMultiplier must be a finite number >= 1, got ${String(input.marginMultiplier)}`
          ))
        }

        const finalCost = Math.round(input.actualCostDecimillicents * input.marginMultiplier)
        if (!isSafeNonNegativeInteger(finalCost)) {
          return yield* Effect.fail(internalError(
            `finalize: finalCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(finalCost)}`
          ))
        }

        // Read auto-recharge settings so the repo can emit credits_low_balance
        // atomically when the debit crosses the threshold.
        const maybeSettings = yield* billingStore
          .getSubscriptionFields(input.organizationId)
          .pipe(
            Effect.mapError((error) =>
              internalError(
                `Failed to read billing settings: ${error instanceof Error ? error.message : String(error)}`
              )
            )
          )
        const lowBalanceThreshold = Option.match(maybeSettings, {
          onNone: () => null as number | null,
          onSome: (settings) =>
            settings.autoRechargeEnabled ? settings.autoRechargeThreshold : null
        })

        // Atomic: release hold + debit actual cost + (optional) outbox event
        yield* creditLedgerStore.finalizeReservation({
          organizationId: input.organizationId,
          releaseAmount: input.estimatedCostDecimillicents,
          debitAmount: finalCost,
          releaseReferenceId: `release:${input.reservationId}`,
          debitReferenceId: `finalize:${input.reservationId}`,
          releaseReason: `Release reservation ${input.reservationId}`,
          debitReason: `Finalize: actual cost with ${input.marginMultiplier}x margin`,
          assetId: input.assetId ?? null,
          phase: input.phase ?? null,
          metadata: input.metadata,
          lowBalanceThreshold
        }).pipe(Effect.mapError(mapCreditError))

        const available = yield* readAvailable(input.organizationId)
        return { finalCostDecimillicents: finalCost, remainingBalance: available }
      }),

    /**
     * Release a reservation without charging (operation failed/cancelled).
     * Decreases `reservedCredits` — creditsBalance unchanged.
     */
    release: (input: {
      organizationId: string
      reservationId: string
      estimatedCostDecimillicents: number
      reason: string
    }): Effect.Effect<{ releasedAmount: number; remainingBalance: number }, CoreError> =>
      Effect.gen(function* () {
        if (!isSafeNonNegativeInteger(input.estimatedCostDecimillicents)) {
          return yield* Effect.fail(internalError(
            `release: estimatedCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.estimatedCostDecimillicents)}`
          ))
        }
        yield* creditLedgerStore.append({
          organizationId: input.organizationId,
          entryType: 'release',
          amountDecimillicents: input.estimatedCostDecimillicents,
          reason: input.reason,
          referenceId: `cancel:${input.reservationId}`
        }).pipe(Effect.mapError(mapCreditError))

        const available = yield* readAvailable(input.organizationId)
        return { releasedAmount: input.estimatedCostDecimillicents, remainingBalance: available }
      }),

    getAvailableBalance: (
      organizationId: string
    ): Effect.Effect<{ creditsBalance: number; reservedCredits: number; available: number }, CoreError> =>
      Effect.gen(function* () {
        const maybeSettings = yield* billingStore.getSubscriptionFields(organizationId).pipe(
          Effect.mapError((error) => internalError(`Failed to fetch org billing: ${error instanceof Error ? error.message : String(error)}`))
        )
        if (Option.isNone(maybeSettings)) {
          return yield* Effect.fail(notFound('Organization billing settings not found'))
        }
        const settings = maybeSettings.value
        return {
          creditsBalance: settings.creditsBalance,
          reservedCredits: settings.reservedCredits,
          available: settings.creditsBalance - settings.reservedCredits
        }
      }),

    /**
     * Apply a Stripe-confirmed purchase to the org balance and emit a
     * `billing.credits_purchased` event in the same DB transaction as the
     * positive ledger row.
     *
     * @spec INV-BILLING-009
     */
    creditsPurchased: (input: {
      organizationId: string
      amountDecimillicents: number
      stripeEventId: string
      referenceId: string
      reason: string
    }): Effect.Effect<{ newBalance: number }, CoreError> =>
      Effect.gen(function* () {
        // Defensive: a credits_purchased call with a bad amount writes
        // a corrupted positive ledger row that's then immutable. The
        // webhook handler computes amount = stripeCents * 100_000, so
        // a Stripe schema drift or a pre-validation bypass could land
        // here with NaN / negative / fractional values.
        if (!isPositiveSafeInteger(input.amountDecimillicents)) {
          return yield* Effect.fail(internalError(
            `creditsPurchased: amountDecimillicents must be a positive integer <= Number.MAX_SAFE_INTEGER, got ${String(input.amountDecimillicents)}`
          ))
        }
        yield* creditLedgerStore.append({
          organizationId: input.organizationId,
          entryType: 'purchase',
          amountDecimillicents: input.amountDecimillicents,
          reason: input.reason,
          referenceId: input.referenceId,
          stripeEventId: input.stripeEventId,
          outboxEvent: {
            eventType: 'billing.credits_purchased',
            aggregateType: 'billing',
            aggregateId: input.organizationId,
            payload: {
              organizationId: input.organizationId,
              amountDecimillicents: input.amountDecimillicents,
              stripeEventId: input.stripeEventId
            },
            correlationId: null
          }
        }).pipe(Effect.mapError(mapCreditError))

        const available = yield* readAvailable(input.organizationId)
        return { newBalance: available }
      }),

    /**
     * Apply a Stripe-confirmed auto-recharge top-up and emit a
     * `billing.credits_recharged` event in the same DB transaction as the
     * positive ledger row.
     *
     * @spec INV-BILLING-009
     */
    creditsRecharged: (input: {
      organizationId: string
      amountDecimillicents: number
      stripePaymentIntentId: string
      stripeEventId: string
      referenceId: string
      reason: string
    }): Effect.Effect<{ newBalance: number }, CoreError> =>
      Effect.gen(function* () {
        if (!isPositiveSafeInteger(input.amountDecimillicents)) {
          return yield* Effect.fail(internalError(
            `creditsRecharged: amountDecimillicents must be a positive integer <= Number.MAX_SAFE_INTEGER, got ${String(input.amountDecimillicents)}`
          ))
        }
        yield* creditLedgerStore.append({
          organizationId: input.organizationId,
          entryType: 'auto_recharge',
          amountDecimillicents: input.amountDecimillicents,
          reason: input.reason,
          referenceId: input.referenceId,
          stripeEventId: input.stripeEventId,
          outboxEvent: {
            eventType: 'billing.credits_recharged',
            aggregateType: 'billing',
            aggregateId: input.organizationId,
            payload: {
              organizationId: input.organizationId,
              amountDecimillicents: input.amountDecimillicents,
              stripePaymentIntentId: input.stripePaymentIntentId
            },
            correlationId: null
          }
        }).pipe(Effect.mapError(mapCreditError))

        const available = yield* readAvailable(input.organizationId)
        return { newBalance: available }
      }),

    /**
     * Scan for reservations older than `maxAgeSeconds` that were never closed
     * by a `finalize` or `release`, and append a compensating `release` row
     * for each one via the existing release path. The ledger stays immutable
     * and the org row is updated atomically per reservation — no cross-row
     * transaction is required because each release already locks the org row
     * FOR UPDATE inside `creditLedgerStore.append`.
     *
     * Idempotency: the scan joins on the close-row shape
     * (`cancel:<id>` / `release:<id>` / `finalize:<id>`), so a reserve that
     * has already been released by a prior run of this method is excluded
     * from the next scan. Re-running the activity after a successful reclaim
     * is a no-op.
     *
     * @spec INV-BILLING-003 — orphaned reservations must be reclaimed.
     */
    releaseStaleReservations: (
      maxAgeSeconds: number
    ): Effect.Effect<{ releasedCount: number }, CoreError> =>
      Effect.gen(function* () {
        if (
          !Number.isFinite(maxAgeSeconds)
          || !Number.isInteger(maxAgeSeconds)
          || !Number.isSafeInteger(maxAgeSeconds)
          || maxAgeSeconds <= 0
        ) {
          return yield* Effect.fail(
            internalError(`maxAgeSeconds must be a positive integer <= Number.MAX_SAFE_INTEGER, got ${String(maxAgeSeconds)}`)
          )
        }

        const olderThan = new Date(Date.now() - maxAgeSeconds * 1000)

        const stale = yield* staleReservationReader
          .findStaleReservations({ olderThan })
          .pipe(Effect.mapError(mapCreditError))

        // Release each stale reservation via the dedicated reclaim path.
        // `tryReleaseStaleReservation` takes the org FOR UPDATE lock and
        // re-checks the close-row triad (`cancel:<id>` / `release:<id>` /
        // `finalize:<id>`) under the lock — so concurrent finalizes /
        // releases / prior reclaims that beat this scan win the race
        // and turn this call into a no-op instead of an over-release
        // error.
        //
        // @spec INV-BILLING-003 — concurrent reclaim must collapse with
        // any other path that closed the reservation first.
        const releasedFlags = yield* Effect.forEach(
          stale,
          (row) =>
            staleReservationReader
              .tryReleaseStaleReservation({
                organizationId: row.organizationId,
                reserveId: row.id,
                amountDecimillicents: row.amountDecimillicents,
                reason: `Reclaim orphaned reservation ${row.id} older than ${maxAgeSeconds}s`
              })
              .pipe(Effect.mapError(mapCreditError)),
          { concurrency: 1 }
        )

        const releasedCount = releasedFlags.filter((r) => r.released).length
        return { releasedCount }
      })
  }
})
