import { Context, type Option } from 'effect'
import type * as Effect from 'effect/Effect'
import type { OrgMemberRole, SubscriptionPlanSlug } from '@tx-agent-kit/contracts'
import type { CoreError } from '../../../errors.js'
import type {
  AutoRechargeRequiresActionChallenge,
  BillingSettingsRecord,
  CreateCheckoutSessionCommand,
  CreatePortalSessionCommand,
  CreditEntryType,
  CreditLedgerEntryRecord,
  JsonObject,
  StripeWebhookEvent,
  SubscriptionEventRecord,
  SubscriptionStatus,
  UsageCategory,
  UsageRecordRecord
} from '../domain/billing-domain.js'

export type { StripeWebhookEvent } from '../domain/billing-domain.js'

export const BillingRepositoryKind = 'custom' as const

export class BillingStorePort extends Context.Tag('BillingStorePort')<
  BillingStorePort,
  {
    getSubscriptionFields: (organizationId: string) => Effect.Effect<Option.Option<BillingSettingsRecord>, unknown>
    findByStripeCustomerId: (stripeCustomerId: string) => Effect.Effect<Option.Option<BillingSettingsRecord>, unknown>
    findByStripeSubscriptionId: (stripeSubscriptionId: string) => Effect.Effect<Option.Option<BillingSettingsRecord>, unknown>
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
        /** When set, clears `organizations.payment_grace_period_ends_at`. The
         *  invoice.payment_succeeded webhook handler sets this to `true` so
         *  a recovering org doesn't stay stuck with a stale grace period. */
        paymentGracePeriodEndsAt?: Date | null
        /** Set by the invoice.payment_succeeded handler after the first
         *  successful charge grants the welcome credit ledger entry.
         *  @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG */
        welcomeCreditGrantedAt?: Date | null
        onlyIfStatusIn?: ReadonlyArray<SubscriptionStatus>
      }
    ) => Effect.Effect<Option.Option<BillingSettingsRecord>, unknown>
    updateBillingSettings: (
      input: {
        organizationId: string
        billingEmail?: string | null
        autoRechargeEnabled?: boolean
        autoRechargeThreshold?: number | null
        autoRechargeAmount?: number | null
        usageCap?: number | null
      }
    ) => Effect.Effect<Option.Option<BillingSettingsRecord>, unknown>
    claimStripeCustomerId: (
      input: {
        organizationId: string
        stripeCustomerId: string
      }
    ) => Effect.Effect<Option.Option<string>, unknown>
    getMemberRole: (organizationId: string, userId: string) => Effect.Effect<Option.Option<OrgMemberRole>, unknown>
  }
>() {}

export class BillingUiPreferenceStorePort extends Context.Tag('BillingUiPreferenceStorePort')<
  BillingUiPreferenceStorePort,
  {
    isNoCapReminderDismissed: (
      userId: string,
      organizationId: string
    ) => Effect.Effect<boolean, unknown>
    dismissNoCapReminder: (
      userId: string,
      organizationId: string
    ) => Effect.Effect<void, unknown>
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
    ) => Effect.Effect<Option.Option<UsageRecordRecord>, unknown>
    updateStripeUsageRecordId: (
      id: string,
      stripeUsageRecordId: string
    ) => Effect.Effect<Option.Option<UsageRecordRecord>, unknown>
    findByReferenceId: (
      organizationId: string,
      referenceId: string
    ) => Effect.Effect<Option.Option<UsageRecordRecord>, unknown>
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
    findByStripeEventId: (stripeEventId: string) => Effect.Effect<Option.Option<SubscriptionEventRecord>, unknown>
    create: (
      input: {
        stripeEventId: string
        eventType: string
        organizationId?: string | null
        payload: JsonObject
      }
    ) => Effect.Effect<Option.Option<SubscriptionEventRecord>, unknown>
    markProcessed: (id: string) => Effect.Effect<Option.Option<SubscriptionEventRecord>, unknown>
  }
>() {}

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
    /** One-time top-up: Stripe Checkout in payment mode for a fixed
     *  amount. Used by POST /v1/billing/:orgId/top-up to let an
     *  authenticated org admin add credits without a subscription. */
    createTopUpSession: (
      input: {
        organizationId: string
        customerId: string
        amountDecimillicents: number
        successUrl: string
        cancelUrl: string
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
    /**
     * Off-session PaymentIntent for auto-recharge top-ups. Charges the org's
     * saved payment method without user interaction. The `idempotencyKey`
     * is the `auto_recharge_attempts.id` — Stripe retries therefore coalesce
     * to the same PaymentIntent.
     *
     * @spec billing-and-pricing-design
     */
    createOffSessionPaymentIntent: (
      input: {
        organizationId: string
        customerId: string
        paymentMethodId: string
        amountDecimillicents: number
        description: string
        idempotencyKey: string
      }
    ) => Effect.Effect<
      {
        id: string
        status: 'succeeded' | 'requires_action' | 'requires_payment_method' | 'canceled'
        amountCharged: number
        /**
         * Stripe PaymentIntent client_secret. Populated only when the
         * caller will need to surface a 3DS challenge URL to the
         * organization owner — i.e. when status is 'requires_action'.
         * `null` for every other status so consumers don't accidentally
         * leak the secret in unrelated audit logs.
         *
         * @spec billing-and-pricing-design §"3DS off-session challenge"
         */
        clientSecret: string | null
      },
      unknown
    >
    /**
     * Pure synchronous lookup that maps a list of Stripe Price IDs (as
     * carried on `subscription.items.data[*].price.id`) onto our internal
     * `SubscriptionPlanSlug` discriminator. Used by the
     * `customer.subscription.created/updated` webhook handler so we
     * persist the actual plan the user paid for, rather than guessing.
     *
     * Returns `'pro'` as a safe fallback when no configured price id
     * matches — historically every paying customer was on Pro and
     * defaulting elsewhere risks under-granting the welcome credit.
     *
     * @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
     */
    resolvePlanFromPriceIds: (
      priceIds: ReadonlyArray<string>
    ) => SubscriptionPlanSlug
  }
>() {}

/**
 * Write-side port for the `auto_recharge_attempts` audit table. Used by
 * {@link BillingService.chargeAutoRecharge} to mark an attempt row as
 * `succeeded` or `failed` once the Stripe PaymentIntent result is known.
 *
 * @spec billing-and-pricing-design
 */
export class AutoRechargeAttemptStorePort extends Context.Tag('AutoRechargeAttemptStorePort')<
  AutoRechargeAttemptStorePort,
  {
    findLatestRequiresActionChallenge: (
      organizationId: string
    ) => Effect.Effect<AutoRechargeRequiresActionChallenge | null, unknown>
    markAttemptSucceeded: (
      attemptId: string,
      stripePaymentIntentId: string
    ) => Effect.Effect<void, unknown>
    markAttemptFailed: (
      attemptId: string,
      reason: string,
      stripePaymentIntentId?: string | null
    ) => Effect.Effect<void, unknown>
    /**
     * Mark the attempt `failed` with reason `'requires user action'` AND
     * emit a `billing.recharge_requires_action` domain event in the same
     * DB transaction. The event payload carries the PaymentIntent id and
     * client_secret so the frontend can surface a 3DS challenge link.
     *
     * @spec billing-and-pricing-design §"3DS off-session challenge"
     * @spec INV-BILLING-009 — atomic ledger commit pattern: event +
     * mutation in the same transaction so consumers never observe one
     * without the other.
     */
    markAttemptRequiresActionAndEmit: (
      input: {
        attemptId: string
        organizationId: string
        amountDecimillicents: number
        stripePaymentIntentId: string
        clientSecret: string
      }
    ) => Effect.Effect<void, unknown>
  }
>() {}

export class BillingGuardPort extends Context.Tag('BillingGuardPort')<
  BillingGuardPort,
  {
    isEnabled: () => Effect.Effect<boolean>
  }
>() {}

/**
 * Transactional email delivery port for the billing subsystem. Phase 1 of
 * the notifications rollout ships billing-event templates that the
 * worker handler (Slice 6) dispatches alongside every in-app notification
 * write. Each method renders a React Email template from
 * `@tx-agent-kit/email` and sends it via Resend.
 *
 * Every method is declared `Effect.Effect<void, unknown>` — we map
 * delivery errors at the adapter seam so upstream callers never see
 * transport-specific error shapes. The implementation is in
 * `apps/api/src/adapters/billing-email.ts` (`BillingEmailPortLive`).
 *
 * @spec billing-and-pricing-design §"Notifications Integration"
 * @spec notifications-design §"Minimal-First Implementation Plan"
 */
export class BillingEmailPort extends Context.Tag('BillingEmailPort')<
  BillingEmailPort,
  {
    sendWelcomeCreditGranted: (input: {
      recipientEmail: string
      recipientName: string
      amountUsd: string
      planDisplayName: string
      dashboardUrl: string
    }) => Effect.Effect<void, unknown>

    sendCreditsLowBalance: (input: {
      recipientEmail: string
      recipientName: string
      currentBalanceUsd: string
      thresholdUsd: string
      topUpUrl: string
    }) => Effect.Effect<void, unknown>

    sendCreditsPurchased: (input: {
      recipientEmail: string
      recipientName: string
      amountUsd: string
      newBalanceUsd: string
      dashboardUrl: string
    }) => Effect.Effect<void, unknown>

    sendCreditsRecharged: (input: {
      recipientEmail: string
      recipientName: string
      amountUsd: string
      newBalanceUsd: string
      dashboardUrl: string
    }) => Effect.Effect<void, unknown>

    sendCreditsRefunded: (input: {
      recipientEmail: string
      recipientName: string
      amountUsd: string
      dashboardUrl: string
    }) => Effect.Effect<void, unknown>

    sendRechargeRequiresAction: (input: {
      recipientEmail: string
      recipientName: string
      amountUsd: string
      challengeUrl: string
    }) => Effect.Effect<void, unknown>

    sendPaymentFailed: (input: {
      recipientEmail: string
      recipientName: string
      gracePeriodEndsAtDisplay: string
      updatePaymentUrl: string
    }) => Effect.Effect<void, unknown>

    sendUsageCapWarning: (input: {
      recipientEmail: string
      recipientName: string
      percentUsed: number
      capUsd: string
      dashboardUrl: string
    }) => Effect.Effect<void, unknown>

    sendUsageCapExceeded: (input: {
      recipientEmail: string
      recipientName: string
      capUsd: string
      dashboardUrl: string
    }) => Effect.Effect<void, unknown>

    sendDisputeCreated: (input: {
      recipientEmail: string
      recipientName: string
      chargeAmountUsd: string
      supportUrl: string
    }) => Effect.Effect<void, unknown>

    sendSubscriptionCancelled: (input: {
      recipientEmail: string
      recipientName: string
      dashboardUrl: string
    }) => Effect.Effect<void, unknown>
  }
>() {}

export class ClockPort extends Context.Tag('ClockPort')<
  ClockPort,
  {
    now: () => Effect.Effect<Date>
  }
>() {}

export class CreditLedgerStorePort extends Context.Tag('CreditLedgerStorePort')<
  CreditLedgerStorePort,
  {
    /**
     * Append a ledger entry. If `outboxEvent` is provided, the domain event
     * is inserted atomically with the ledger row.
     *
     * @spec INV-BILLING-009
     */
    append: (input: {
      organizationId: string
      entryType: CreditEntryType
      amountDecimillicents: number
      reason: string
      referenceId?: string | null
      stripeEventId?: string | null
      assetId?: string | null
      phase?: string | null
      metadata?: JsonObject
      /**
       * When true, re-reads `organizations.suspended_at` inside the
       * same transaction as the ledger append (under the FOR UPDATE
       * lock) and fails with an "Organization is suspended" sentinel
       * error if set. Closes the TOCTOU window between a separate
       * suspension check and the lock acquisition.
       * @spec INV-BILLING-003
       */
      failIfSuspended?: boolean
      outboxEvent?: {
        eventType: string
        aggregateType: string
        aggregateId: string
        payload: JsonObject
        correlationId?: string | null
      }
      /**
       * When set, the same transaction also stamps
       * `organizations.welcome_credit_granted_at = $stampWelcomeCreditAt`.
       * The webhook handler uses this to atomically commit the welcome
       * credit ledger row, the outbox event, AND the
       * `welcome_credit_granted_at` column — closing the historical hole
       * where the column update was a separate post-transaction call
       * and a crash between commit and stamp would leave the column
       * NULL forever (see fix in feat/billing-v2-impl).
       *
       * @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
       */
      stampWelcomeCreditAt?: Date
    }) => Effect.Effect<CreditLedgerEntryRecord, unknown>
    /**
     * Atomic release + debit in a single transaction (for finalize). If
     * `lowBalanceThreshold` is provided and the new available balance crosses
     * it from above to below, a `billing.credits_low_balance` event is
     * committed in the same transaction.
     *
     * @spec INV-BILLING-009
     */
    finalizeReservation: (input: {
      organizationId: string
      releaseAmount: number
      debitAmount: number
      releaseReferenceId: string
      debitReferenceId: string
      releaseReason: string
      debitReason: string
      assetId?: string | null
      phase?: string | null
      metadata?: JsonObject
      lowBalanceThreshold?: number | null
    }) => Effect.Effect<CreditLedgerEntryRecord, unknown>
    listForOrganization: (input: {
      organizationId: string
      entryType?: CreditEntryType
      after?: Date
      before?: Date
      limit?: number
      cursor?: string
    }) => Effect.Effect<ReadonlyArray<CreditLedgerEntryRecord>, unknown>
    existsByStripeEventId: (stripeEventId: string) => Effect.Effect<boolean, unknown>
  }
>() {}

export class ProcessedStripeEventStorePort extends Context.Tag('ProcessedStripeEventStorePort')<
  ProcessedStripeEventStorePort,
  {
    tryInsert: (eventId: string) => Effect.Effect<boolean, unknown>
    findById: (eventId: string) => Effect.Effect<{ eventId: string; processedAt: Date } | null, unknown>
    /** Release a claim committed by `tryInsert` when the downstream
     *  handler has failed. @spec INV-BILLING-005 */
    deleteByEventId: (eventId: string) => Effect.Effect<boolean, unknown>
  }
>() {}

export class UsageCapStorePort extends Context.Tag('UsageCapStorePort')<
  UsageCapStorePort,
  {
    /**
     * Atomically read the organization's `usage_cap` together with the
     * current period's `credits_used`. Returns `Option.none` if the org
     * does not exist. The `usageCapDecimillicents` field is itself an
     * Option because `organizations.usage_cap` is nullable (null = uncapped).
     */
    getOrgCapState: (
      orgId: string,
      periodStart: Date,
      periodEnd: Date
    ) => Effect.Effect<
      Option.Option<{
        usageCapDecimillicents: Option.Option<number>
        creditsUsed: number
      }>,
      unknown
    >
    /**
     * Atomic single-statement increment of credits_used for the given period.
     *
     * @spec INV-BILLING-008
     */
    incrementMonthlyUsage: (
      orgId: string,
      periodStart: Date,
      periodEnd: Date,
      deltaDecimillicents: number,
      planTier: string | null
    ) => Effect.Effect<void, unknown>
    /**
     * Atomic increment + transactional outbox emission. Classifies the
     * before/after credits_used against the 80 / 95 / 100 % thresholds and,
     * when a threshold is crossed for the first time, emits the matching
     * `billing.usage_cap_warning` or `billing.usage_cap_exceeded` event in
     * the SAME transaction as the counter update.
     *
     * @spec INV-BILLING-008
     * @spec INV-BILLING-009
     */
    incrementMonthlyUsageAndEmit: (
      orgId: string,
      periodStart: Date,
      periodEnd: Date,
      deltaDecimillicents: number,
      planTier: string | null
    ) => Effect.Effect<
      {
        previousCreditsUsed: number
        newCreditsUsed: number
        capDecimillicents: number | null
        emittedEventType: null | 'billing.usage_cap_warning' | 'billing.usage_cap_exceeded'
      },
      unknown
    >
    /**
     * Emit a `billing.usage_cap_exceeded` domain event without mutating the
     * counter. Used by the rejection path when `checkUsageCaps` refuses a
     * reservation that would push the org over 100 %.
     *
     * @spec INV-BILLING-009
     */
    emitUsageCapExceeded: (
      orgId: string,
      capDecimillicents: number
    ) => Effect.Effect<void, unknown>
  }
>() {}

export class UsageCapServicePort extends Context.Tag('UsageCapServicePort')<
  UsageCapServicePort,
  {
    checkUsageCaps: (input: {
      organizationId: string
      estimatedCostDecimillicents: number
      periodStart: Date
      periodEnd: Date
      planTier: string
    }) => Effect.Effect<
      {
        warningLevel: 'none' | 'warning_80' | 'warning_95' | 'exceeded'
        usageCapDecimillicents: number | null
        creditsUsedAfter: number
      },
      CoreError
    >
    /**
     * Atomic increment helper callers use AFTER a successful AI operation.
     *
     * @spec INV-BILLING-008
     */
    incrementMonthlyUsage: (input: {
      organizationId: string
      periodStart: Date
      periodEnd: Date
      deltaDecimillicents: number
      planTier: string | null
    }) => Effect.Effect<void, CoreError>
    /**
     * Atomic increment + transactional outbox emission on threshold
     * crossings. Callers use this AFTER a successful AI operation so the
     * counter update and the warning event commit together.
     *
     * @spec INV-BILLING-008
     * @spec INV-BILLING-009
     */
    incrementMonthlyUsageAndEmit: (input: {
      organizationId: string
      periodStart: Date
      periodEnd: Date
      deltaDecimillicents: number
      planTier: string | null
    }) => Effect.Effect<
      {
        previousCreditsUsed: number
        newCreditsUsed: number
        capDecimillicents: number | null
        emittedEventType: null | 'billing.usage_cap_warning' | 'billing.usage_cap_exceeded'
      },
      CoreError
    >
  }
>() {}

export class CreditServicePort extends Context.Tag('CreditServicePort')<
  CreditServicePort,
  {
    reserve: (input: {
      organizationId: string
      estimatedCostDecimillicents: number
      referenceId: string
      reason: string
    }) => Effect.Effect<{ reservationId: string; remainingBalance: number }, CoreError>
    finalize: (input: {
      organizationId: string
      reservationId: string
      estimatedCostDecimillicents: number
      actualCostDecimillicents: number
      marginMultiplier: number
      assetId?: string | null
      phase?: string | null
      metadata?: JsonObject
    }) => Effect.Effect<{ finalCostDecimillicents: number; remainingBalance: number }, CoreError>
    release: (input: {
      organizationId: string
      reservationId: string
      estimatedCostDecimillicents: number
      reason: string
    }) => Effect.Effect<{ releasedAmount: number; remainingBalance: number }, CoreError>
    getAvailableBalance: (
      organizationId: string
    ) => Effect.Effect<{ creditsBalance: number; reservedCredits: number; available: number }, CoreError>
    /**
     * Credit a purchase that was confirmed by Stripe. Atomically appends a
     * positive ledger row and emits `billing.credits_purchased` in the same
     * transaction.
     *
     * @spec INV-BILLING-009
     */
    creditsPurchased: (input: {
      organizationId: string
      amountDecimillicents: number
      stripeEventId: string
      referenceId: string
      reason: string
    }) => Effect.Effect<{ newBalance: number }, CoreError>
    /**
     * Credit an auto-recharge top-up confirmed by Stripe. Atomically appends
     * a positive ledger row and emits `billing.credits_recharged` in the
     * same transaction.
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
    }) => Effect.Effect<{ newBalance: number }, CoreError>
    /**
     * Reclaim orphaned reservations older than `maxAgeSeconds`. Driven by a
     * scheduled Temporal workflow — see `releaseStaleReservationsWorkflow`.
     *
     * @spec INV-BILLING-003 — reservation lifecycle.
     */
    releaseStaleReservations: (
      maxAgeSeconds: number
    ) => Effect.Effect<{ releasedCount: number }, CoreError>
  }
>() {}

export class StorageUsageReaderPort extends Context.Tag('StorageUsageReaderPort')<
  StorageUsageReaderPort,
  {
    /**
     * Real-time active storage bytes for an organization. Reads the
     * `storage_metering.active_bytes` counter maintained by the assets domain
     * on every upload / delete.
     */
    getRealtimeBytes: (organizationId: string) => Effect.Effect<Option.Option<number>, unknown>
    /**
     * Most recent `storage_usage` rollup row for the organization. Used by
     * monthly reconciliation to charge ongoing overage from the period's
     * snapshot.
     */
    getCurrentPeriodUsage: (
      organizationId: string
    ) => Effect.Effect<
      Option.Option<{
        currentBytes: number
        planStorageLimit: number
        planTier: string | null
        periodStart: Date
      }>,
      unknown
    >
  }
>() {}

export class StorageBillingServicePort extends Context.Tag('StorageBillingServicePort')<
  StorageBillingServicePort,
  {
    preUploadCheck: (input: {
      organizationId: string
      fileSizeBytes: number
    }) => Effect.Effect<{ allowed: boolean; overageBytes: number; overageCostDecimillicents: number; reason?: string }, CoreError>
    chargeStorageOverage: (input: {
      organizationId: string
      overageBytes: number
      costDecimillicents: number
      referenceId: string
    }) => Effect.Effect<{ charged: boolean }, CoreError>
    reconcileMonthlyOverage: (
      organizationId: string
    ) => Effect.Effect<{ overageBytes: number; chargedDecimillicents: number }, CoreError>
  }
>() {}

export class StripeWebhookHandlerPort extends Context.Tag('StripeWebhookHandlerPort')<
  StripeWebhookHandlerPort,
  {
    handle: (
      rawBody: string,
      signature: string
    ) => Effect.Effect<{ processed: true; idempotent: boolean; eventId: string }, CoreError>
    handleDispute: (input: {
      eventId: string
      disputeStatus: 'created' | 'closed'
      outcome?: 'won' | 'lost'
      chargeAmountDecimillicents: number
      organizationId: string
    }) => Effect.Effect<void, CoreError>
  }
>() {}
