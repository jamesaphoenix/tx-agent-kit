import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { type SubscriptionStatus } from '@tx-agent-kit/contracts'
import { Effect, Option } from 'effect'
import { organizationRowSchema } from '../effect-schemas/organizations.js'
import { organizations } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decodeOrg = createOptionalDecoder(organizationRowSchema, 'organization row')

const billingSelectColumns = {
  id: organizations.id,
  name: organizations.name,
  billingEmail: organizations.billingEmail,
  onboardingData: organizations.onboardingData,
  stripeCustomerId: organizations.stripeCustomerId,
  stripeSubscriptionId: organizations.stripeSubscriptionId,
  stripePaymentMethodId: organizations.stripePaymentMethodId,
  stripeMeteredSubscriptionItemId: organizations.stripeMeteredSubscriptionItemId,
  creditsBalance: organizations.creditsBalance,
  reservedCredits: organizations.reservedCredits,
  autoRechargeEnabled: organizations.autoRechargeEnabled,
  autoRechargeThreshold: organizations.autoRechargeThreshold,
  autoRechargeAmount: organizations.autoRechargeAmount,
  isSubscribed: organizations.isSubscribed,
  subscriptionStatus: organizations.subscriptionStatus,
  subscriptionPlan: organizations.subscriptionPlan,
  subscriptionStartedAt: organizations.subscriptionStartedAt,
  subscriptionEndsAt: organizations.subscriptionEndsAt,
  subscriptionCurrentPeriodEnd: organizations.subscriptionCurrentPeriodEnd,
  ownerUserId: organizations.ownerUserId,
  usageCap: organizations.usageCap,
  paymentGracePeriodEndsAt: organizations.paymentGracePeriodEndsAt,
  suspendedAt: organizations.suspendedAt,
  welcomeCreditGrantedAt: organizations.welcomeCreditGrantedAt,
  createdAt: organizations.createdAt,
  updatedAt: organizations.updatedAt,
} as const

type BillingSettingsPatch = {
  billingEmail?: string | null
  autoRechargeEnabled?: boolean
  autoRechargeThreshold?: number | null
  autoRechargeAmount?: number | null
  usageCap?: number | null
}

type SubscriptionPatch = {
  billingEmail?: string | null
  stripeCustomerId?: string | null
  welcomeCreditGrantedAt?: Date | null
  stripeSubscriptionId?: string | null
  stripePaymentMethodId?: string | null
  stripeMeteredSubscriptionItemId?: string | null
  isSubscribed?: boolean
  subscriptionStatus?: SubscriptionStatus
  subscriptionPlan?: string | null
  subscriptionStartedAt?: Date | null
  subscriptionEndsAt?: Date | null
  subscriptionCurrentPeriodEnd?: Date | null
  paymentGracePeriodEndsAt?: Date | null
}

export const billingRepository = {
  getSubscriptionFields: (organizationId: string) =>
    withDb('Failed to fetch billing subscription fields', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(billingSelectColumns)
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeOrg)
      })
    ),

  findByStripeCustomerId: (stripeCustomerId: string) =>
    withDb('Failed to fetch billing org by Stripe customer id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(billingSelectColumns)
          .from(organizations)
          .where(eq(organizations.stripeCustomerId, stripeCustomerId))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeOrg)
      })
    ),

  findByStripeSubscriptionId: (stripeSubscriptionId: string) =>
    withDb('Failed to fetch billing org by Stripe subscription id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(billingSelectColumns)
          .from(organizations)
          .where(eq(organizations.stripeSubscriptionId, stripeSubscriptionId))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeOrg)
      })
    ),

  updateSubscriptionFields: (input: { organizationId: string; onlyIfStatusIn?: ReadonlyArray<SubscriptionStatus> } & SubscriptionPatch) =>
    withDb('Failed to update billing subscription fields', (db) =>
      Effect.gen(function* () {
        const patch: SubscriptionPatch = {}

        if (input.billingEmail !== undefined) {
          patch.billingEmail = input.billingEmail
        }
        if (input.stripeCustomerId !== undefined) {
          patch.stripeCustomerId = input.stripeCustomerId
        }
        if (input.stripeSubscriptionId !== undefined) {
          patch.stripeSubscriptionId = input.stripeSubscriptionId
        }
        if (input.stripePaymentMethodId !== undefined) {
          patch.stripePaymentMethodId = input.stripePaymentMethodId
        }
        if (input.stripeMeteredSubscriptionItemId !== undefined) {
          patch.stripeMeteredSubscriptionItemId = input.stripeMeteredSubscriptionItemId
        }
        if (input.isSubscribed !== undefined) {
          patch.isSubscribed = input.isSubscribed
        }
        if (input.subscriptionStatus !== undefined) {
          patch.subscriptionStatus = input.subscriptionStatus
        }
        if (input.subscriptionPlan !== undefined) {
          patch.subscriptionPlan = input.subscriptionPlan
        }
        if (input.subscriptionStartedAt !== undefined) {
          patch.subscriptionStartedAt = input.subscriptionStartedAt
        }
        if (input.subscriptionEndsAt !== undefined) {
          patch.subscriptionEndsAt = input.subscriptionEndsAt
        }
        if (input.subscriptionCurrentPeriodEnd !== undefined) {
          patch.subscriptionCurrentPeriodEnd = input.subscriptionCurrentPeriodEnd
        }
        if (input.paymentGracePeriodEndsAt !== undefined) {
          patch.paymentGracePeriodEndsAt = input.paymentGracePeriodEndsAt
        }
        if (input.welcomeCreditGrantedAt !== undefined) {
          patch.welcomeCreditGrantedAt = input.welcomeCreditGrantedAt
        }

        // Period-end monotonic guard: when the patch moves
        // `subscriptionCurrentPeriodEnd`, reject the update if the stored
        // value is already >= the incoming value. This closes the
        // out-of-order `customer.subscription.updated` window where a
        // late-delivered older event could roll the period end backwards,
        // corrupting usage-cap reset timing and monthly rollups. The guard
        // is implicit — no call-site change needed — because every legitimate
        // patch of `subscriptionCurrentPeriodEnd` is monotonic in event time.
        const periodEndGuard = patch.subscriptionCurrentPeriodEnd !== undefined
          ? sql`(${organizations.subscriptionCurrentPeriodEnd} IS NULL OR ${organizations.subscriptionCurrentPeriodEnd} <= ${patch.subscriptionCurrentPeriodEnd})`
          : null

        const idPredicate = eq(organizations.id, input.organizationId)
        const statusPredicate = input.onlyIfStatusIn && input.onlyIfStatusIn.length > 0
          ? inArray(organizations.subscriptionStatus, [...input.onlyIfStatusIn])
          : null
        const extraPredicates = [statusPredicate, periodEndGuard].filter((p): p is NonNullable<typeof p> => p !== null)
        const whereCondition = extraPredicates.length === 0
          ? idPredicate
          : and(idPredicate, ...extraPredicates) ?? idPredicate

        const rows = yield* db
          .update(organizations)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(whereCondition)
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeOrg)
      })
    ),

  updateBillingSettings: (input: { organizationId: string } & BillingSettingsPatch) =>
    withDb('Failed to update billing settings', (db) =>
      Effect.gen(function* () {
        const patch: BillingSettingsPatch = {}

        if (input.billingEmail !== undefined) {
          patch.billingEmail = input.billingEmail
        }
        if (input.autoRechargeEnabled !== undefined) {
          patch.autoRechargeEnabled = input.autoRechargeEnabled
        }
        if (input.autoRechargeThreshold !== undefined) {
          patch.autoRechargeThreshold = input.autoRechargeThreshold
        }
        if (input.autoRechargeAmount !== undefined) {
          patch.autoRechargeAmount = input.autoRechargeAmount
        }
        if (input.usageCap !== undefined) {
          patch.usageCap = input.usageCap
        }

        if (Object.keys(patch).length === 0) {
          const rows = yield* db
            .select(billingSelectColumns)
            .from(organizations)
            .where(eq(organizations.id, input.organizationId))
            .limit(1)
            .execute()

          return yield* decodeFirst(rows, decodeOrg)
        }

        const rows = yield* db
          .update(organizations)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(organizations.id, input.organizationId))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeOrg)
      })
    ),

  claimStripeCustomerId: (input: { organizationId: string; stripeCustomerId: string }) =>
    withDb('Failed to claim Stripe customer ID', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(organizations)
          .set({ stripeCustomerId: input.stripeCustomerId, updatedAt: sql`now()` })
          .where(
            and(
              eq(organizations.id, input.organizationId),
              isNull(organizations.stripeCustomerId)
            )
          )
          .returning({ stripeCustomerId: organizations.stripeCustomerId })
          .execute()

        if (rows.length > 0) {
          return Option.fromNullable(rows[0]?.stripeCustomerId ?? null)
        }

        const existing = yield* db
          .select({ stripeCustomerId: organizations.stripeCustomerId })
          .from(organizations)
          .where(eq(organizations.id, input.organizationId))
          .limit(1)
          .execute()

        return Option.fromNullable(existing[0]?.stripeCustomerId ?? null)
      })
    )
}
