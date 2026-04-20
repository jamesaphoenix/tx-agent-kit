import { Context, Effect, Layer, Option } from 'effect'
import {
  DEFAULT_MARGIN_MULTIPLIER,
  DEFAULT_STORAGE_LIMIT_BYTES,
  STORAGE_HARD_CAP_MULTIPLIER,
  getSubscriptionPlan,
  subscriptionPlans
} from '@tx-agent-kit/contracts'
import type { SubscriptionPlanSlug } from '@tx-agent-kit/contracts'
import { internalError, type CoreError } from '../../../errors.js'
import type { StorageMeteringRecord } from '../domain/assets-domain.js'
import { StorageMeteringPort, SubscriptionLookupPort } from '../ports/assets-ports.js'

const BYTES_PER_GB = 1_073_741_824

const isSubscriptionPlanSlug = (slug: string | null): slug is SubscriptionPlanSlug =>
  slug !== null && slug in subscriptionPlans

const computeStorageOverageCostDecimillicents = (
  overageBytes: number,
  ratePerGbDecimillicents: number
): number => {
  if (overageBytes <= 0) { return 0 }
  const marginBasisPoints = BigInt(Math.round(DEFAULT_MARGIN_MULTIPLIER * 10_000))
  const numerator =
    BigInt(overageBytes)
    * BigInt(ratePerGbDecimillicents)
    * marginBasisPoints
  const denominator = BigInt(BYTES_PER_GB) * 10_000n
  return Number((numerator + denominator - 1n) / denominator)
}

export interface QuotaCheckResult {
  allowed: boolean
  hasSubscription: boolean
  inOverage: boolean
  currentBytes: number
  includedBytes: number
  hardCapBytes: number
}

export class StorageMeteringService extends Context.Tag('StorageMeteringService')<
  StorageMeteringService,
  {
    getUsage: (
      organizationId: string
    ) => Effect.Effect<StorageMeteringRecord, CoreError, StorageMeteringPort>
    checkQuota: (
      organizationId: string,
      additionalBytes: number
    ) => Effect.Effect<
      QuotaCheckResult,
      CoreError,
      StorageMeteringPort | SubscriptionLookupPort
    >
  }
>() {}

export const StorageMeteringServiceLive = Layer.effect(
  StorageMeteringService,
  Effect.succeed({
    getUsage: (organizationId) =>
      Effect.gen(function* () {
        const port = yield* StorageMeteringPort
        const maybeMetering = yield* port.getForOrganization(organizationId).pipe(
          Effect.mapError((cause) => internalError('Failed to get storage metering', cause))
        )
        return Option.match(maybeMetering, {
          onNone: () => ({
            organizationId,
            activeBytes: 0,
            softDeletedBytes: 0,
            activeAssetCount: 0,
            softDeletedAssetCount: 0,
            highWaterMarkBytes: 0,
            measuredAt: new Date()
          }),
          onSome: (metering) => metering
        })
      }),

    checkQuota: (organizationId, additionalBytes) =>
      Effect.gen(function* () {
        const meteringPort = yield* StorageMeteringPort
        const subscriptionLookup = yield* SubscriptionLookupPort

        // Get current storage usage
        const maybeMetering = yield* meteringPort.getForOrganization(organizationId).pipe(
          Effect.mapError((cause) => internalError('Failed to get storage metering', cause))
        )
        const currentBytes = Option.match(maybeMetering, {
          onNone: () => 0,
          onSome: (m) => m.activeBytes
        })

        // Look up subscription info
        const maybeSubscription = yield* subscriptionLookup.getSubscriptionInfo(organizationId).pipe(
          Effect.mapError((cause) => internalError('Failed to get subscription info', cause))
        )

        const subscriptionInfo = Option.getOrElse(maybeSubscription, () => ({
          isSubscribed: false,
          subscriptionPlan: null as string | null,
          creditsBalance: 0,
          reservedCredits: 0
        }))

        // No subscription → reject
        if (!subscriptionInfo.isSubscribed) {
          return {
            allowed: false,
            hasSubscription: false,
            inOverage: false,
            currentBytes,
            includedBytes: 0,
            hardCapBytes: 0
          }
        }

        // Resolve plan limits
        if (subscriptionInfo.subscriptionPlan !== null && !isSubscriptionPlanSlug(subscriptionInfo.subscriptionPlan)) {
          return yield* Effect.fail(internalError(`Unknown subscription plan: ${subscriptionInfo.subscriptionPlan}`))
        }

        const plan = subscriptionInfo.subscriptionPlan
          ? getSubscriptionPlan(subscriptionInfo.subscriptionPlan)
          : getSubscriptionPlan('try_me')
        const includedBytes = subscriptionInfo.subscriptionPlan
          ? plan.featureLimits.storageIncludedBytes
          : DEFAULT_STORAGE_LIMIT_BYTES
        const hardCapBytes = includedBytes * STORAGE_HARD_CAP_MULTIPLIER
        const projectedBytes = currentBytes + additionalBytes
        const overageBytes = Math.max(projectedBytes - includedBytes, 0)
        const projectedOverageCostDecimillicents = computeStorageOverageCostDecimillicents(
          overageBytes,
          plan.featureLimits.storageOverageRateDecimillicentsPerGbMonth
        )
        const availableCredits = subscriptionInfo.creditsBalance - subscriptionInfo.reservedCredits

        // Over hard cap → reject
        if (projectedBytes > hardCapBytes) {
          return {
            allowed: false,
            hasSubscription: true,
            inOverage: overageBytes > 0,
            currentBytes,
            includedBytes,
            hardCapBytes
          }
        }

        if (projectedOverageCostDecimillicents > availableCredits) {
          return {
            allowed: false,
            hasSubscription: true,
            inOverage: true,
            currentBytes,
            includedBytes,
            hardCapBytes
          }
        }

        // Allow (possibly in overage zone)
        return {
          allowed: true,
          hasSubscription: true,
          inOverage: overageBytes > 0,
          currentBytes,
          includedBytes,
          hardCapBytes
        }
      })
  })
)
