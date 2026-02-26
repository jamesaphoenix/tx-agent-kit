import { Context, Effect, Layer } from 'effect'
import { badRequest, notFound, unauthorized, type CoreError } from '../../../errors.js'
import {
  canAccessFeature,
  isSubscriptionActive,
  isSubscriptionGuardSatisfied,
  toBillingSettings,
  toUsageRecord,
  type BillingSettings,
  type CreateCheckoutSessionCommand,
  type CreatePortalSessionCommand,
  type JsonObject,
  type RecordUsageCommand,
  type SubscriptionStatus,
  type UpdateBillingSettingsCommand,
  type UsageRecord,
  type UsageSummary,
  type UsageSummaryCommand
} from '../domain/billing-domain.js'
import {
  BillingGuardPort,
  BillingStorePort,
  ClockPort,
  StripePort,
  SubscriptionEventStorePort,
  UsageStorePort
} from '../ports/billing-ports.js'

const canManageBilling = (role: string): boolean => role === 'owner' || role === 'admin'

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readObjectField = (record: JsonObject, key: string): JsonObject | null => {
  const value = record[key]
  return isJsonObject(value) ? value : null
}

const readArrayField = (record: JsonObject, key: string): ReadonlyArray<JsonObject> => {
  const value = record[key]
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is JsonObject => isJsonObject(entry))
}

const readStringField = (record: JsonObject, key: string): string | null => {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const readNumberField = (record: JsonObject, key: string): number | null => {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const parseSubscriptionStatus = (value: string | null): SubscriptionStatus | null => {
  if (!value) {
    return null
  }

  switch (value) {
    case 'active':
    case 'inactive':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'paused':
    case 'unpaid':
      return value
    default:
      return null
  }
}

const toDateFromUnixSeconds = (value: number | null): Date | null =>
  typeof value === 'number' ? new Date(value * 1000) : null

const resolveOrganizationIdFromEvent = (object: JsonObject): string | null => {
  const metadata = readObjectField(object, 'metadata')
  const metadataOrgId = metadata
    ? readStringField(metadata, 'organizationId') ?? readStringField(metadata, 'organization_id')
    : null

  if (metadataOrgId) {
    return metadataOrgId
  }

  return readStringField(object, 'client_reference_id')
}

const resolveMeteredSubscriptionItemId = (subscriptionObject: JsonObject): string | null => {
  const items = readObjectField(subscriptionObject, 'items')
  if (!items) {
    return null
  }

  const itemRows = readArrayField(items, 'data')

  for (const item of itemRows) {
    const price = readObjectField(item, 'price')
    const recurring = price ? readObjectField(price, 'recurring') : null
    const usageType = recurring ? readStringField(recurring, 'usage_type') : null
    if (usageType === 'metered') {
      return readStringField(item, 'id')
    }
  }

  return null
}

const resolveOrganizationIdForEvent = (
  object: JsonObject,
  lookupBySubscriptionId: (subscriptionId: string) => Effect.Effect<string | null, CoreError>,
  lookupByCustomerId: (customerId: string) => Effect.Effect<string | null, CoreError>
): Effect.Effect<string | null, CoreError> =>
  Effect.gen(function* () {
    const direct = resolveOrganizationIdFromEvent(object)
    if (direct) {
      return direct
    }

    const subscriptionId = readStringField(object, 'subscription') ?? readStringField(object, 'id')
    if (subscriptionId) {
      const bySubscription = yield* lookupBySubscriptionId(subscriptionId)
      if (bySubscription) {
        return bySubscription
      }
    }

    const customerId = readStringField(object, 'customer')
    if (customerId) {
      return yield* lookupByCustomerId(customerId)
    }

    return null
  })

const assertBillingAccess = (
  organizationId: string,
  principal: { userId: string },
  requiresManageBilling: boolean
): Effect.Effect<void, CoreError, BillingStorePort> =>
  Effect.gen(function* () {
    const billingStore = yield* BillingStorePort
    const role = yield* billingStore.getMemberRole(organizationId, principal.userId).pipe(
      Effect.mapError(() => unauthorized('Failed to verify organization membership'))
    )

    if (!role) {
      return yield* Effect.fail(unauthorized('Not allowed to access this organization'))
    }

    if (requiresManageBilling && !canManageBilling(role)) {
      return yield* Effect.fail(unauthorized('Only owners and admins can manage billing'))
    }
  })

export class BillingService extends Context.Tag('BillingService')<
  BillingService,
  {
    getBillingSettings: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<BillingSettings, CoreError, BillingStorePort>
    updateBillingSettings: (
      principal: { userId: string },
      organizationId: string,
      input: UpdateBillingSettingsCommand
    ) => Effect.Effect<BillingSettings, CoreError, BillingStorePort>
    createCheckoutSession: (
      principal: { userId: string; email: string },
      input: CreateCheckoutSessionCommand
    ) => Effect.Effect<
      { id: string; url: string },
      CoreError,
      BillingStorePort | StripePort
    >
    createPortalSession: (
      principal: { userId: string },
      input: CreatePortalSessionCommand
    ) => Effect.Effect<
      { id: string; url: string },
      CoreError,
      BillingStorePort | StripePort
    >
    processWebhookEvent: (
      rawBody: string,
      signature: string
    ) => Effect.Effect<
      { processed: true; idempotent: boolean; eventId: string },
      CoreError,
      BillingStorePort | StripePort | SubscriptionEventStorePort | ClockPort
    >
    recordUsage: (input: RecordUsageCommand) => Effect.Effect<
      UsageRecord,
      CoreError,
      BillingStorePort | UsageStorePort | StripePort | BillingGuardPort | ClockPort
    >
    getUsageSummary: (
      principal: { userId: string },
      input: UsageSummaryCommand
    ) => Effect.Effect<UsageSummary, CoreError, BillingStorePort | UsageStorePort | BillingGuardPort>
  }
>() {}

export const BillingServiceLive = Layer.effect(
  BillingService,
  Effect.succeed({
    getBillingSettings: (principal, organizationId) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(organizationId, principal, false)
        const billingStore = yield* BillingStorePort

        const settings = yield* billingStore.getSubscriptionFields(organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch billing settings'))
        )

        if (!settings) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        return toBillingSettings(settings)
      }),

    updateBillingSettings: (principal, organizationId, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(organizationId, principal, true)
        const billingStore = yield* BillingStorePort

        const updated = yield* billingStore.updateBillingSettings({
          organizationId,
          billingEmail: input.billingEmail,
          autoRechargeEnabled: input.autoRechargeEnabled,
          autoRechargeThreshold: input.autoRechargeThresholdDecimillicents,
          autoRechargeAmount: input.autoRechargeAmountDecimillicents
        }).pipe(Effect.mapError(() => badRequest('Failed to update billing settings')))

        if (!updated) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        return toBillingSettings(updated)
      }),

    createCheckoutSession: (principal, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(input.organizationId, principal, true)
        const billingStore = yield* BillingStorePort
        const stripe = yield* StripePort

        const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch billing settings'))
        )

        if (!settings) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        const customerId = settings.stripeCustomerId
          ? settings.stripeCustomerId
          : (yield* stripe.createCustomer({
              organizationId: input.organizationId,
              email: principal.email
            }).pipe(Effect.mapError(() => badRequest('Failed to create Stripe customer')))).id

        if (!settings.stripeCustomerId) {
          yield* billingStore.updateSubscriptionFields({
            organizationId: input.organizationId,
            stripeCustomerId: customerId
          }).pipe(Effect.mapError(() => badRequest('Failed to update billing customer reference')))
        }

        return yield* stripe.createCheckoutSession({
          ...input,
          customerId
        }).pipe(Effect.mapError(() => badRequest('Failed to create checkout session')))
      }),

    createPortalSession: (principal, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(input.organizationId, principal, true)
        const billingStore = yield* BillingStorePort
        const stripe = yield* StripePort
        const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch billing settings'))
        )

        if (!settings) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        if (!settings.stripeCustomerId) {
          return yield* Effect.fail(badRequest('Stripe customer is not configured for this organization'))
        }

        return yield* stripe.createPortalSession({
          ...input,
          customerId: settings.stripeCustomerId
        }).pipe(Effect.mapError(() => badRequest('Failed to create billing portal session')))
      }),

    processWebhookEvent: (rawBody, signature) =>
      Effect.gen(function* () {
        const stripe = yield* StripePort
        const eventStore = yield* SubscriptionEventStorePort
        const billingStore = yield* BillingStorePort
        const clock = yield* ClockPort

        const event = yield* stripe.constructWebhookEvent(rawBody, signature).pipe(
          Effect.mapError(() => badRequest('Invalid Stripe webhook signature'))
        )

        const existingEvent = yield* eventStore.findByStripeEventId(event.id).pipe(
          Effect.mapError(() => badRequest('Failed to check webhook idempotency'))
        )

        if (existingEvent?.processedAt) {
          return {
            processed: true as const,
            idempotent: true as const,
            eventId: event.id
          }
        }

        const resolveBySubscriptionId = (subscriptionId: string): Effect.Effect<string | null, CoreError> =>
          billingStore
            .findByStripeSubscriptionId(subscriptionId)
            .pipe(
              Effect.mapError(() => badRequest('Failed to resolve organization for subscription webhook')),
              Effect.map((row) => row?.id ?? null)
            )

        const resolveByCustomerId = (customerId: string): Effect.Effect<string | null, CoreError> =>
          billingStore
            .findByStripeCustomerId(customerId)
            .pipe(
              Effect.mapError(() => badRequest('Failed to resolve organization for customer webhook')),
              Effect.map((row) => row?.id ?? null)
            )

        const organizationId = yield* resolveOrganizationIdForEvent(
          event.data.object,
          resolveBySubscriptionId,
          resolveByCustomerId
        )

        const createdEvent = existingEvent ?? (yield* eventStore.create({
          stripeEventId: event.id,
          eventType: event.type,
          organizationId,
          payload: event.payload
        }).pipe(Effect.mapError(() => badRequest('Failed to persist webhook event'))))

        if (!createdEvent) {
          return yield* Effect.fail(badRequest('Failed to persist webhook event'))
        }

        if (organizationId) {
          if (event.type === 'checkout.session.completed') {
            yield* billingStore.updateSubscriptionFields({
              organizationId,
              stripeCustomerId: readStringField(event.data.object, 'customer'),
              stripeSubscriptionId: readStringField(event.data.object, 'subscription'),
              stripePaymentMethodId: readStringField(event.data.object, 'payment_method'),
              isSubscribed: true,
              subscriptionStatus: 'active',
              subscriptionPlan: 'pro'
            }).pipe(Effect.mapError(() => badRequest('Failed to persist checkout webhook state')))
          } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
            const status = parseSubscriptionStatus(readStringField(event.data.object, 'status')) ?? 'inactive'
            const startDate = toDateFromUnixSeconds(readNumberField(event.data.object, 'start_date'))
            const endedAt = toDateFromUnixSeconds(
              readNumberField(event.data.object, 'ended_at') ?? readNumberField(event.data.object, 'cancel_at')
            )
            const currentPeriodEnd = toDateFromUnixSeconds(readNumberField(event.data.object, 'current_period_end'))
            const meteredItemId = resolveMeteredSubscriptionItemId(event.data.object)

            yield* billingStore.updateSubscriptionFields({
              organizationId,
              stripeCustomerId: readStringField(event.data.object, 'customer'),
              stripeSubscriptionId: readStringField(event.data.object, 'id'),
              stripeMeteredSubscriptionItemId: meteredItemId,
              isSubscribed: canAccessFeature('pro', status, 'free'),
              subscriptionStatus: status,
              subscriptionPlan: 'pro',
              subscriptionStartedAt: startDate,
              subscriptionEndsAt: endedAt,
              subscriptionCurrentPeriodEnd: currentPeriodEnd
            }).pipe(Effect.mapError(() => badRequest('Failed to persist subscription webhook state')))
          } else if (event.type === 'customer.subscription.deleted') {
            const now = yield* clock.now()
            yield* billingStore.updateSubscriptionFields({
              organizationId,
              isSubscribed: false,
              subscriptionStatus: 'canceled',
              subscriptionEndsAt: now
            }).pipe(Effect.mapError(() => badRequest('Failed to persist cancellation webhook state')))
          } else if (event.type === 'invoice.payment_failed') {
            yield* billingStore.updateSubscriptionFields({
              organizationId,
              subscriptionStatus: 'past_due'
            }).pipe(Effect.mapError(() => badRequest('Failed to persist failed payment webhook state')))
          } else if (event.type === 'invoice.payment_succeeded') {
            yield* billingStore.updateSubscriptionFields({
              organizationId,
              isSubscribed: true,
              subscriptionStatus: 'active'
            }).pipe(Effect.mapError(() => badRequest('Failed to persist payment success webhook state')))
          }
        }

        const processedAt = yield* clock.now()
        yield* eventStore.markProcessed(createdEvent.id, processedAt).pipe(
          Effect.mapError(() => badRequest('Failed to mark webhook event processed'))
        )

        return {
          processed: true as const,
          idempotent: false as const,
          eventId: event.id
        }
      }),

    recordUsage: (input) =>
      Effect.gen(function* () {
        const billingStore = yield* BillingStorePort
        const usageStore = yield* UsageStorePort
        const stripe = yield* StripePort
        const guard = yield* BillingGuardPort
        const clock = yield* ClockPort

        if (input.quantity < 1 || input.unitCostDecimillicents < 0) {
          return yield* Effect.fail(badRequest('Invalid usage payload'))
        }

        const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch billing settings'))
        )

        if (!settings) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        const guardEnabled = yield* guard.isEnabled()
        if (!isSubscriptionGuardSatisfied(
          { subscriptionStatus: settings.subscriptionStatus, isSubscribed: settings.isSubscribed },
          guardEnabled
        )) {
          return yield* Effect.fail(unauthorized('Active subscription required'))
        }

        if (input.referenceId) {
          const existing = yield* usageStore.findByReferenceId(input.organizationId, input.referenceId).pipe(
            Effect.mapError(() => badRequest('Failed to look up usage reference'))
          )

          if (existing) {
            return toUsageRecord(existing)
          }
        }

        const totalCostDecimillicents = input.quantity * input.unitCostDecimillicents
        const recordedAt = yield* clock.now()
        let stripeUsageRecordId: string | null = null

        if (settings.stripeMeteredSubscriptionItemId) {
          const usageRecord = yield* stripe.reportUsage({
            subscriptionItemId: settings.stripeMeteredSubscriptionItemId,
            quantity: input.quantity,
            timestamp: recordedAt,
            idempotencyKey: input.referenceId ?? undefined
          }).pipe(Effect.mapError(() => badRequest('Failed to report usage to Stripe')))

          stripeUsageRecordId = usageRecord.id
        }

        const recorded = yield* usageStore.record({
          organizationId: input.organizationId,
          category: input.category,
          quantity: input.quantity,
          unitCostDecimillicents: input.unitCostDecimillicents,
          totalCostDecimillicents,
          referenceId: input.referenceId ?? null,
          stripeUsageRecordId,
          metadata: input.metadata ?? {},
          recordedAt
        }).pipe(Effect.mapError(() => badRequest('Failed to record usage')))

        if (!recorded) {
          return yield* Effect.fail(badRequest('Failed to record usage'))
        }

        return toUsageRecord(recorded)
      }),

    getUsageSummary: (principal, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(input.organizationId, principal, false)
        const billingStore = yield* BillingStorePort
        const usageStore = yield* UsageStorePort
        const guard = yield* BillingGuardPort

        const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch billing settings'))
        )

        if (!settings) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        const guardEnabled = yield* guard.isEnabled()
        if (guardEnabled && !isSubscriptionActive(settings.subscriptionStatus)) {
          return yield* Effect.fail(unauthorized('Active subscription required'))
        }

        const summary = yield* usageStore.summarizeForPeriod({
          organizationId: input.organizationId,
          category: input.category,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd
        }).pipe(Effect.mapError(() => badRequest('Failed to summarize usage')))

        return {
          organizationId: input.organizationId,
          category: input.category,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          totalQuantity: summary.totalQuantity,
          totalCostDecimillicents: summary.totalCostDecimillicents
        }
      })
  })
)
