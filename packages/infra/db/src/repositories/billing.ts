import { eq } from 'drizzle-orm'
import { type CreditEntryType, type SubscriptionStatus } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { creditLedgerRowSchema, type CreditLedgerRowShape } from '../effect-schemas/credit-ledger.js'
import { organizationRowSchema, type OrganizationRowShape } from '../effect-schemas/organizations.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { creditLedger, organizations, type JsonObject } from '../schema.js'

const decodeOrganizationRow = Schema.decodeUnknown(organizationRowSchema)
const decodeCreditLedgerRow = Schema.decodeUnknown(creditLedgerRowSchema)

const decodeNullableOrganization = (
  value: unknown
): Effect.Effect<OrganizationRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeOrganizationRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('organization row decode failed', error))
  )
}

const decodeNullableCreditLedger = (
  value: unknown
): Effect.Effect<CreditLedgerRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeCreditLedgerRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('credit ledger row decode failed', error))
  )
}

type BillingSettingsPatch = {
  billingEmail?: string | null
  autoRechargeEnabled?: boolean
  autoRechargeThreshold?: number | null
  autoRechargeAmount?: number | null
}

type SubscriptionPatch = {
  billingEmail?: string | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  stripePaymentMethodId?: string | null
  stripeMeteredSubscriptionItemId?: string | null
  isSubscribed?: boolean
  subscriptionStatus?: SubscriptionStatus
  subscriptionPlan?: string | null
  subscriptionStartedAt?: Date | null
  subscriptionEndsAt?: Date | null
  subscriptionCurrentPeriodEnd?: Date | null
}

export const billingRepository = {
  getSubscriptionFields: (organizationId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1)
          .execute()

        return yield* decodeNullableOrganization(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch billing subscription fields', error))),

  findByStripeCustomerId: (stripeCustomerId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(organizations)
          .where(eq(organizations.stripeCustomerId, stripeCustomerId))
          .limit(1)
          .execute()

        return yield* decodeNullableOrganization(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch billing org by Stripe customer id', error))),

  findByStripeSubscriptionId: (stripeSubscriptionId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(organizations)
          .where(eq(organizations.stripeSubscriptionId, stripeSubscriptionId))
          .limit(1)
          .execute()

        return yield* decodeNullableOrganization(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch billing org by Stripe subscription id', error))),

  updateSubscriptionFields: (input: { organizationId: string } & SubscriptionPatch) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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

        const rows = yield* db
          .update(organizations)
          .set(patch)
          .where(eq(organizations.id, input.organizationId))
          .returning()
          .execute()

        return yield* decodeNullableOrganization(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update billing subscription fields', error))),

  updateBillingSettings: (input: { organizationId: string } & BillingSettingsPatch) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
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

        if (Object.keys(patch).length === 0) {
          const rows = yield* db
            .select()
            .from(organizations)
            .where(eq(organizations.id, input.organizationId))
            .limit(1)
            .execute()

          return yield* decodeNullableOrganization(rows[0] ?? null)
        }

        const rows = yield* db
          .update(organizations)
          .set(patch)
          .where(eq(organizations.id, input.organizationId))
          .returning()
          .execute()

        return yield* decodeNullableOrganization(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update billing settings', error))),

  adjustCredits: (input: {
    organizationId: string
    amountDecimillicents: number
    entryType: CreditEntryType
    reason: string
    referenceId?: string | null
    metadata?: JsonObject
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const result = yield* db.transaction((trx) =>
          Effect.gen(function* () {
            const orgRows = yield* trx
              .select({ creditsBalance: organizations.creditsBalance })
              .from(organizations)
              .where(eq(organizations.id, input.organizationId))
              .limit(1)
              .execute()

            const org = orgRows[0]
            if (!org) {
              return null
            }

            const nextBalance = org.creditsBalance + input.amountDecimillicents

            yield* trx
              .update(organizations)
              .set({ creditsBalance: nextBalance })
              .where(eq(organizations.id, input.organizationId))
              .execute()

            const ledgerRows = yield* trx
              .insert(creditLedger)
              .values({
                organizationId: input.organizationId,
                amount: input.amountDecimillicents,
                entryType: input.entryType,
                reason: input.reason,
                referenceId: input.referenceId ?? null,
                balanceAfter: nextBalance,
                metadata: input.metadata ?? {}
              })
              .returning()
              .execute()

            return ledgerRows[0] ?? null
          })
        )

        return yield* decodeNullableCreditLedger(result)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to adjust organization credits', error)))
}
