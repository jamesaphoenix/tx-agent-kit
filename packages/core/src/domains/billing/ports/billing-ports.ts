import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { OrgMemberRole } from '@tx-agent-kit/contracts'
import type {
  BillingSettingsRecord,
  CreateCheckoutSessionCommand,
  CreatePortalSessionCommand,
  CreditEntryType,
  CreditLedgerEntryRecord,
  JsonObject,
  SubscriptionEventRecord,
  SubscriptionStatus,
  UsageCategory,
  UsageRecordRecord
} from '../domain/billing-domain.js'

export const BillingRepositoryKind = 'custom' as const

export class BillingStorePort extends Context.Tag('BillingStorePort')<
  BillingStorePort,
  {
    getSubscriptionFields: (organizationId: string) => Effect.Effect<BillingSettingsRecord | null, unknown>
    findByStripeCustomerId: (stripeCustomerId: string) => Effect.Effect<BillingSettingsRecord | null, unknown>
    findByStripeSubscriptionId: (stripeSubscriptionId: string) => Effect.Effect<BillingSettingsRecord | null, unknown>
    updateSubscriptionFields: (
      input: {
        organizationId: string
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
    ) => Effect.Effect<BillingSettingsRecord | null, unknown>
    updateBillingSettings: (
      input: {
        organizationId: string
        billingEmail?: string | null
        autoRechargeEnabled?: boolean
        autoRechargeThreshold?: number | null
        autoRechargeAmount?: number | null
      }
    ) => Effect.Effect<BillingSettingsRecord | null, unknown>
    adjustCredits: (
      input: {
        organizationId: string
        amountDecimillicents: number
        entryType: CreditEntryType
        reason: string
        referenceId?: string | null
        metadata?: JsonObject
      }
    ) => Effect.Effect<CreditLedgerEntryRecord | null, unknown>
    getMemberRole: (organizationId: string, userId: string) => Effect.Effect<OrgMemberRole | null, unknown>
  }
>() {}

export class UsageStorePort extends Context.Tag('UsageStorePort')<
  UsageStorePort,
  {
    record: (
      input: {
        organizationId: string
        category: UsageCategory
        quantity: number
        unitCostDecimillicents: number
        totalCostDecimillicents: number
        referenceId?: string | null
        stripeUsageRecordId?: string | null
        metadata?: JsonObject
        recordedAt?: Date
      }
    ) => Effect.Effect<UsageRecordRecord | null, unknown>
    updateStripeUsageRecordId: (
      id: string,
      stripeUsageRecordId: string
    ) => Effect.Effect<UsageRecordRecord | null, unknown>
    findByReferenceId: (
      organizationId: string,
      referenceId: string
    ) => Effect.Effect<UsageRecordRecord | null, unknown>
    listForOrganization: (
      input: {
        organizationId: string
        category?: UsageCategory
        recordedAfter?: Date
        recordedBefore?: Date
        limit?: number
      }
    ) => Effect.Effect<ReadonlyArray<UsageRecordRecord>, unknown>
    summarizeForPeriod: (
      input: {
        organizationId: string
        category: UsageCategory
        periodStart: Date
        periodEnd: Date
      }
    ) => Effect.Effect<{ totalQuantity: number; totalCostDecimillicents: number }, unknown>
  }
>() {}

export class SubscriptionEventStorePort extends Context.Tag('SubscriptionEventStorePort')<
  SubscriptionEventStorePort,
  {
    findByStripeEventId: (stripeEventId: string) => Effect.Effect<SubscriptionEventRecord | null, unknown>
    create: (
      input: {
        stripeEventId: string
        eventType: string
        organizationId?: string | null
        payload: JsonObject
      }
    ) => Effect.Effect<SubscriptionEventRecord | null, unknown>
    markProcessed: (id: string, processedAt?: Date) => Effect.Effect<SubscriptionEventRecord | null, unknown>
  }
>() {}

export interface StripeWebhookEvent {
  id: string
  type: string
  payload: JsonObject
  data: {
    object: JsonObject
  }
}

export class StripePort extends Context.Tag('StripePort')<
  StripePort,
  {
    createCheckoutSession: (
      input: CreateCheckoutSessionCommand & {
        customerId: string
      }
    ) => Effect.Effect<{ id: string; url: string }, unknown>
    createPortalSession: (
      input: CreatePortalSessionCommand & {
        customerId: string
      }
    ) => Effect.Effect<{ id: string; url: string }, unknown>
    constructWebhookEvent: (
      rawBody: string,
      signature: string
    ) => Effect.Effect<StripeWebhookEvent, unknown>
    createCustomer: (
      input: {
        organizationId: string
        email: string
      }
    ) => Effect.Effect<{ id: string }, unknown>
    reportUsage: (
      input: {
        subscriptionItemId: string
        quantity: number
        timestamp: Date
        idempotencyKey?: string
      }
    ) => Effect.Effect<{ id: string }, unknown>
  }
>() {}

export class BillingGuardPort extends Context.Tag('BillingGuardPort')<
  BillingGuardPort,
  {
    isEnabled: () => Effect.Effect<boolean, never>
  }
>() {}

export class ClockPort extends Context.Tag('ClockPort')<
  ClockPort,
  {
    now: () => Effect.Effect<Date, never>
  }
>() {}
