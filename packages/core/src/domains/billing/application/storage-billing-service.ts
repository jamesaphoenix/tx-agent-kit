import {
  DEFAULT_MARGIN_MULTIPLIER,
  STORAGE_HARD_CAP_MULTIPLIER,
  subscriptionPlans,
  type SubscriptionPlanSlug
} from '@tx-agent-kit/contracts'
import { randomUUID } from 'node:crypto'
import { Effect, Option } from 'effect'
import { badRequest, internalError, notFound, type CoreError } from '../../../errors.js'
import {
  BillingStorePort,
  CreditLedgerStorePort,
  StorageUsageReaderPort
} from '../ports/billing-ports.js'

/**
 * Storage Billing Service — prepaid credits model.
 *
 * Implements the three storage-billing methods required by
 * {@link StorageBillingServicePort}:
 *
 *  - `preUploadCheck`  — at presigned-URL time, projects the post-upload
 *    storage total against the plan allocation, a plan hard ceiling, and the
 *    org's available credits.
 *  - `chargeStorageOverage` — debits the calculated overage cost from the
 *    org's `credits_balance` via a negative credit-ledger row. Idempotent by
 *    `referenceId` (the ledger repo short-circuits on duplicates).
 *  - `reconcileMonthlyOverage` — monthly job: re-reads the period rollup
 *    (`storage_usage.current_bytes`) and charges ongoing overage for files
 *    still stored after the upload-time charge has expired. Uses a
 *    `YYYY-MM` reference id so repeated runs in the same month are
 *    idempotent.
 *
 * @spec billing-and-pricing-design.md — §"Storage Billing: Prepaid Credits Model"
 * @spec INV-BILLING-006 — a fixed margin multiplier (1.10x) is applied to
 *       the base storage overage rate so the debit matches the customer-facing
 *       cost surfaced elsewhere.
 */

const BYTES_PER_GB = 1_073_741_824

/**
 * Plan hard ceiling factor — sourced from the contracts package
 * (`STORAGE_HARD_CAP_MULTIPLIER`) so the storage-billing service and
 * the assets-side `storage-metering-service` (which used the same
 * constant from contracts already) can never drift apart. The
 * billing design doc fixes a uniform 2× rule across every plan so
 * operators have a single mental model: no upload may push storage
 * past `2 × plan.storageIncludedBytes`, regardless of credit balance.
 *
 * @spec billing-and-pricing-design §"Storage System"
 */
const computeStorageHardCeiling = (planLimitBytes: number): number =>
  planLimitBytes * STORAGE_HARD_CAP_MULTIPLIER

const isSubscriptionPlanSlug = (slug: string | null): slug is SubscriptionPlanSlug => {
  if (slug === null) { return false }
  return slug in subscriptionPlans
}

/**
 * @spec INV-BILLING-006
 * Compute the overage cost from a byte delta using the plan's per-GB rate
 * and the default margin multiplier. Uses integer basis points + ceil-
 * division so the service never undercharges below the decimillicent
 * unit, AND uses BigInt for the multiplication so realistic overages
 * (10s-100s of GB) don't silently overflow Number.MAX_SAFE_INTEGER.
 *
 * The naive `overageBytes * rate * marginBasisPoints` exceeds 9e15 for
 * any overage above ~10 MB at typical R2 rates, producing a wrong
 * (and unbounded) result. BigInt promotion keeps every step exact.
 */
const computeOverageCostDecimillicents = (
  overageBytes: number,
  ratePerGbDecimillicents: number
): number => {
  if (overageBytes <= 0) { return 0 }
  const marginBasisPoints = BigInt(Math.round(DEFAULT_MARGIN_MULTIPLIER * 10_000)) // 11_000
  const numerator =
    BigInt(overageBytes)
    * BigInt(ratePerGbDecimillicents)
    * marginBasisPoints
  const denominator = BigInt(BYTES_PER_GB) * 10_000n
  // Ceiling division for BigInt: (n + d - 1) / d. Math.ceil rounds UP
  // so the debit is never short.
  const result = (numerator + denominator - 1n) / denominator
  return Number(result)
}

const mapStoreError = (error: unknown): CoreError => {
  const msg = error instanceof Error ? error.message : String(error)
  return internalError(`Storage billing store operation failed: ${msg}`)
}

const formatMonthTag = (date: Date): string =>
  `${date.getUTCFullYear().toString().padStart(4, '0')}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}`

const isSafeNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0

export const makeStorageBillingService = Effect.gen(function* () {
  const billingStore = yield* BillingStorePort
  const creditLedgerStore = yield* CreditLedgerStorePort
  const storageUsageReader = yield* StorageUsageReaderPort

  const preUploadCheck = (input: {
    organizationId: string
    fileSizeBytes: number
  }): Effect.Effect<
    { allowed: boolean; overageBytes: number; overageCostDecimillicents: number; reason?: string },
    CoreError
  > =>
    Effect.gen(function* () {
      if (!isSafeNonNegativeInteger(input.fileSizeBytes)) {
        return yield* Effect.fail(badRequest(
          `preUploadCheck: fileSizeBytes must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.fileSizeBytes)}`
        ))
      }

      const maybeSettings = yield* billingStore
        .getSubscriptionFields(input.organizationId)
        .pipe(Effect.mapError(mapStoreError))

      if (Option.isNone(maybeSettings)) {
        return yield* Effect.fail(notFound('Organization billing settings not found'))
      }
      const settings = maybeSettings.value

      if (!isSubscriptionPlanSlug(settings.subscriptionPlan)) {
        return yield* Effect.fail(
          notFound(`Organization is not on a known subscription plan: ${settings.subscriptionPlan ?? 'null'}`)
        )
      }
      const plan = subscriptionPlans[settings.subscriptionPlan]
      const planLimit = plan.featureLimits.storageIncludedBytes
      const hardCeiling = computeStorageHardCeiling(planLimit)

      const maybeCurrent = yield* storageUsageReader
        .getRealtimeBytes(input.organizationId)
        .pipe(Effect.mapError(mapStoreError))
      const currentBytes = Option.getOrElse(maybeCurrent, () => 0)

      const newBytes = currentBytes + input.fileSizeBytes

      // Within included allocation — always allowed, free.
      if (newBytes <= planLimit) {
        return { allowed: true, overageBytes: 0, overageCostDecimillicents: 0 }
      }

      const overageBytes = newBytes - planLimit
      const overageCostDecimillicents = computeOverageCostDecimillicents(
        overageBytes,
        plan.featureLimits.storageOverageRateDecimillicentsPerGbMonth
      )

      // Hard ceiling beats credit balance — no matter how much is in the
      // wallet, the upload is rejected.
      if (newBytes > hardCeiling) {
        return {
          allowed: false,
          overageBytes,
          overageCostDecimillicents,
          reason: 'hard ceiling exceeded'
        }
      }

      const available = settings.creditsBalance - settings.reservedCredits
      if (available < overageCostDecimillicents) {
        return {
          allowed: false,
          overageBytes,
          overageCostDecimillicents,
          reason: 'insufficient credits for overage'
        }
      }

      return { allowed: true, overageBytes, overageCostDecimillicents }
    })

  const chargeStorageOverage = (input: {
    organizationId: string
    overageBytes: number
    costDecimillicents: number
    referenceId: string
  }): Effect.Effect<{ charged: boolean }, CoreError> =>
    Effect.gen(function* () {
      // Defensive validation at the service seam — same pattern as
      // credit-service's reserve / finalize / release. The cost lands
      // directly on the immutable credit_ledger as a negative
      // adjustment to the bigint column.
      if (!isSafeNonNegativeInteger(input.costDecimillicents)) {
        return yield* Effect.fail(badRequest(
          `chargeStorageOverage: costDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.costDecimillicents)}`
        ))
      }
      if (!isSafeNonNegativeInteger(input.overageBytes)) {
        return yield* Effect.fail(internalError(
          `chargeStorageOverage: overageBytes must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.overageBytes)}`
        ))
      }
      if (input.costDecimillicents === 0) {
        return { charged: false }
      }

      // Embed a unique per-call marker in metadata so we can detect
      // whether THIS call's append was a fresh insert vs. an idempotent
      // return of a row from a prior caller. The previous detection
      // compared `entry.balanceAfter === beforeBalance - cost`, which
      // mis-classified a fresh charge as "no-op" whenever any other
      // unrelated activity changed the balance between the read and
      // the append (race window). The metadata marker is bulletproof
      // because the repo's idempotent return path returns the
      // ORIGINAL row's metadata, which carries the FIRST caller's
      // marker — never ours.
      const callMarker = randomUUID()
      const entry = yield* creditLedgerStore
        .append({
          organizationId: input.organizationId,
          entryType: 'usage',
          amountDecimillicents: -input.costDecimillicents,
          reason: 'storage_overage',
          referenceId: input.referenceId,
          metadata: {
            overageBytes: input.overageBytes,
            chargeStorageOverageMarker: callMarker
          }
        })
        .pipe(Effect.mapError(mapStoreError))

      const entryMetadata = entry.metadata as { chargeStorageOverageMarker?: unknown }
      const charged = entryMetadata.chargeStorageOverageMarker === callMarker
      return { charged }
    })

  const reconcileMonthlyOverage = (
    organizationId: string
  ): Effect.Effect<{ overageBytes: number; chargedDecimillicents: number }, CoreError> =>
    Effect.gen(function* () {
      const maybeSettings = yield* billingStore
        .getSubscriptionFields(organizationId)
        .pipe(Effect.mapError(mapStoreError))
      if (Option.isNone(maybeSettings)) {
        return yield* Effect.fail(notFound('Organization billing settings not found'))
      }
      const settings = maybeSettings.value
      if (!isSubscriptionPlanSlug(settings.subscriptionPlan)) {
        return yield* Effect.fail(
          notFound(`Organization is not on a known subscription plan: ${settings.subscriptionPlan ?? 'null'}`)
        )
      }
      const plan = subscriptionPlans[settings.subscriptionPlan]

      const maybeUsage = yield* storageUsageReader
        .getCurrentPeriodUsage(organizationId)
        .pipe(Effect.mapError(mapStoreError))
      if (Option.isNone(maybeUsage)) {
        // No rollup row yet — nothing to reconcile.
        return { overageBytes: 0, chargedDecimillicents: 0 }
      }
      const usage = maybeUsage.value

      // Prefer the rollup row's `plan_storage_limit` for historical
      // correctness (the plan might have been downgraded mid-period), and
      // fall back to the live plan limit otherwise.
      const planLimit = usage.planStorageLimit > 0
        ? usage.planStorageLimit
        : plan.featureLimits.storageIncludedBytes

      if (usage.currentBytes <= planLimit) {
        return { overageBytes: 0, chargedDecimillicents: 0 }
      }

      const overageBytes = usage.currentBytes - planLimit
      const costDecimillicents = computeOverageCostDecimillicents(
        overageBytes,
        plan.featureLimits.storageOverageRateDecimillicentsPerGbMonth
      )

      const referenceId = `reconcile:${organizationId}:${formatMonthTag(usage.periodStart)}`
      const result = yield* chargeStorageOverage({
        organizationId,
        overageBytes,
        costDecimillicents,
        referenceId
      })

      return {
        overageBytes,
        chargedDecimillicents: result.charged ? costDecimillicents : 0
      }
    })

  return {
    preUploadCheck,
    chargeStorageOverage,
    reconcileMonthlyOverage
  }
})
