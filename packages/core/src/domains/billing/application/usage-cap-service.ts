import { Effect, Option } from 'effect'
import { internalError, notFound, paymentRequired, type CoreError } from '../../../errors.js'
import { UsageCapStorePort } from '../ports/billing-ports.js'

type WarningLevel = 'none' | 'warning_80' | 'warning_95' | 'exceeded'

// Thresholds are inclusive on the high side to match the atomic
// `incrementMonthlyUsageAndEmit` path in packages/infra/db/src/repositories/
// usage-cap.ts, which crosses at `newPercent >= X`. Without matching
// semantics the predictive check and the atomic increment disagree at
// exactly 80 / 95 / 100 %, causing a silent fencepost bug: an operation
// projected at exactly 100% would pass the pre-check with warning_95
// while the post-mutation emit would fire usage_cap_exceeded.
const classifyPercent = (percent: number): WarningLevel => {
  if (percent >= 100) {
    return 'exceeded'
  }
  if (percent >= 95) {
    return 'warning_95'
  }
  if (percent >= 80) {
    return 'warning_80'
  }
  return 'none'
}

const mapStoreError = (error: unknown): CoreError => {
  const msg = error instanceof Error ? error.message : String(error)
  return internalError(`Usage cap store operation failed: ${msg}`)
}

const isSafeNonNegativeInteger = (value: number): boolean =>
  Number.isFinite(value)
  && Number.isInteger(value)
  && Number.isSafeInteger(value)
  && value >= 0

/**
 * Two-level usage cap enforcement. Performs an atomic read of the org's
 * `usage_cap` and the current period's `credits_used`, projects the
 * post-operation total, and classifies the result.
 *
 * Emits WARNING events at the 80% / 95% thresholds and fails with
 * `paymentRequired` (HTTP 402) when the projected total exceeds 100%.
 *
 * The caller is responsible for calling `incrementMonthlyUsage` AFTER the
 * AI operation actually succeeds — this service never increments on its
 * own, so a rejected op never touches the counter.
 */
export const makeUsageCapService = Effect.gen(function* () {
  const usageCapStore = yield* UsageCapStorePort

  const checkUsageCaps = (input: {
    organizationId: string
    estimatedCostDecimillicents: number
    periodStart: Date
    periodEnd: Date
    planTier: string
  }): Effect.Effect<
    {
      warningLevel: WarningLevel
      usageCapDecimillicents: number | null
      creditsUsedAfter: number
    },
    CoreError
  > =>
    Effect.gen(function* () {
      // Defensive: a negative estimated cost lowers the projected
      // creditsUsedAfter and silently slips the op past the cap. NaN
      // poisons the comparison. Same shape as the credit-service /
      // storage-billing service hardening.
      if (!isSafeNonNegativeInteger(input.estimatedCostDecimillicents)) {
        return yield* Effect.fail(internalError(
          `checkUsageCaps: estimatedCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.estimatedCostDecimillicents)}`
        ))
      }
      const maybeState = yield* usageCapStore
        .getOrgCapState(input.organizationId, input.periodStart, input.periodEnd)
        .pipe(Effect.mapError(mapStoreError))

      if (Option.isNone(maybeState)) {
        return yield* Effect.fail(notFound('Organization not found for usage cap check'))
      }

      const state = maybeState.value
      if (!isSafeNonNegativeInteger(state.creditsUsed)) {
        return yield* Effect.fail(internalError(
          `checkUsageCaps: creditsUsed must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(state.creditsUsed)}`
        ))
      }
      const creditsUsedAfter = state.creditsUsed + input.estimatedCostDecimillicents
      if (!isSafeNonNegativeInteger(creditsUsedAfter)) {
        return yield* Effect.fail(internalError(
          `checkUsageCaps: creditsUsedAfter must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(creditsUsedAfter)}`
        ))
      }

      if (Option.isNone(state.usageCapDecimillicents)) {
        return {
          warningLevel: 'none' as const,
          usageCapDecimillicents: null,
          creditsUsedAfter
        }
      }

      const cap = state.usageCapDecimillicents.value
      if (!isSafeNonNegativeInteger(cap)) {
        return yield* Effect.fail(internalError(
          `checkUsageCaps: usageCapDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(cap)}`
        ))
      }
      // Guard against divide-by-zero: cap of 0 means "everything is over".
      if (cap <= 0) {
        // @spec INV-BILLING-009 — emit even though no mutation happens,
        // so downstream consumers observe the cap trip.
        yield* usageCapStore
          .emitUsageCapExceeded(input.organizationId, cap)
          .pipe(Effect.mapError(mapStoreError))
        return yield* Effect.fail(paymentRequired('Organization usage cap exceeded'))
      }

      const percent = (creditsUsedAfter / cap) * 100
      const warningLevel = classifyPercent(percent)

      if (warningLevel === 'exceeded') {
        // @spec INV-BILLING-009 — emit usage_cap_exceeded BEFORE failing so
        // the rejection is visible to downstream consumers (suspension,
        // notifications).
        yield* usageCapStore
          .emitUsageCapExceeded(input.organizationId, cap)
          .pipe(Effect.mapError(mapStoreError))
        return yield* Effect.fail(paymentRequired('Organization usage cap exceeded'))
      }

      return {
        warningLevel,
        usageCapDecimillicents: cap,
        creditsUsedAfter
      }
    })

  /**
   * Atomic single-statement increment wrapper. Callers invoke this after a
   * successful AI operation to bump `monthly_credits_usage.credits_used`.
   *
   * @spec INV-BILLING-008
   */
  const incrementMonthlyUsage = (input: {
    organizationId: string
    periodStart: Date
    periodEnd: Date
    deltaDecimillicents: number
    planTier: string | null
  }): Effect.Effect<void, CoreError> =>
    Effect.gen(function* () {
      // Defensive: a negative or NaN delta would corrupt the
      // monthly_credits_usage counter. The repo path already validates
      // but the error surfaces as a generic internalError; pinning at
      // the service seam gives a clean call-site signal.
      if (!isSafeNonNegativeInteger(input.deltaDecimillicents)) {
        return yield* Effect.fail(internalError(
          `incrementMonthlyUsage: deltaDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.deltaDecimillicents)}`
        ))
      }
      yield* usageCapStore
        .incrementMonthlyUsage(
          input.organizationId,
          input.periodStart,
          input.periodEnd,
          input.deltaDecimillicents,
          input.planTier
        )
        .pipe(Effect.mapError(mapStoreError))
    })

  /**
   * Atomic increment + transactional outbox emission. Classifies the
   * before/after `credits_used` against the 80 / 95 / 100 % thresholds and
   * emits the matching `billing.usage_cap_warning` or
   * `billing.usage_cap_exceeded` event in the SAME DB transaction as the
   * counter update. Callers invoke this AFTER a successful AI operation.
   *
   * @spec INV-BILLING-008
   * @spec INV-BILLING-009
   */
  const incrementMonthlyUsageAndEmit = (input: {
    organizationId: string
    periodStart: Date
    periodEnd: Date
    deltaDecimillicents: number
    planTier: string | null
  }): Effect.Effect<
    {
      previousCreditsUsed: number
      newCreditsUsed: number
      capDecimillicents: number | null
      emittedEventType: null | 'billing.usage_cap_warning' | 'billing.usage_cap_exceeded'
    },
    CoreError
  > =>
    Effect.gen(function* () {
      if (!isSafeNonNegativeInteger(input.deltaDecimillicents)) {
        return yield* Effect.fail(internalError(
          `incrementMonthlyUsageAndEmit: deltaDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.deltaDecimillicents)}`
        ))
      }
      return yield* usageCapStore
        .incrementMonthlyUsageAndEmit(
          input.organizationId,
          input.periodStart,
          input.periodEnd,
          input.deltaDecimillicents,
          input.planTier
        )
        .pipe(Effect.mapError(mapStoreError))
    })

  return {
    checkUsageCaps,
    incrementMonthlyUsage,
    incrementMonthlyUsageAndEmit
  }
})
