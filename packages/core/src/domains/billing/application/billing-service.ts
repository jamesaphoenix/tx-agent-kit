import {
  AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS,
  AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS,
  AUTO_RECHARGE_THRESHOLD_MAX_DECIMILLICENTS,
  AUTO_RECHARGE_THRESHOLD_MIN_DECIMILLICENTS,
  LOCAL_DEV_SUBSCRIPTION_PERIOD_MS,
  PAYMENT_GRACE_PERIOD_MS,
  TOP_UP_MAX_DECIMILLICENTS,
  TOP_UP_MIN_DECIMILLICENTS,
  WELCOME_CREDIT_DECIMILLICENTS,
  type CostResult,
  type SubscriptionPlanSlug,
  type UsageCategory
} from '@tx-agent-kit/contracts'
import { Context, Effect, Layer, Option } from 'effect'
import { badRequest, notFound, unauthorized, type CoreError } from '../../../errors.js'
import {
  type AutoRechargeRequiresActionChallenge,
  canAccessFeature,
  isSubscriptionActive,
  isSubscriptionGuardSatisfied,
  type NoCapReminderPreference,
  toBillingSettings,
  type BillingSettings,
  type CompleteLocalBillingSetupCommand,
  type CreateCheckoutSessionCommand,
  type CreatePortalSessionCommand,
  type CreateTopUpSessionCommand,
  type JsonObject,
  type RecordUsageCommand,
  type SubscriptionStatus,
  type UpdateBillingSettingsCommand,
  type UsageRecord,
  type UsageSummary,
  type UsageSummaryCommand
} from '../domain/billing-domain.js'
import {
  AutoRechargeAttemptStorePort,
  BillingGuardPort,
  BillingStorePort,
  BillingUiPreferenceStorePort,
  ClockPort,
  CreditLedgerStorePort,
  CreditServicePort,
  ProcessedStripeEventStorePort,
  StripePort,
  SubscriptionEventStorePort,
  UsageStorePort
} from '../ports/billing-ports.js'

const canManageBilling = (role: string): boolean => role === 'admin'

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readObjectField = (record: JsonObject, key: string): JsonObject | null => {
  const value = record[key]
  return isJsonObject(value) ? value : null
}

const readStringField = (record: JsonObject, key: string): string | null => {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const collectSubscriptionPriceIds = (record: JsonObject): ReadonlyArray<string> => {
  const items = readObjectField(record, 'items')
  if (!items) {
    return []
  }

  const data = items.data
  if (!Array.isArray(data)) {
    return []
  }

  const priceIds: Array<string> = []
  for (const item of data) {
    if (!isJsonObject(item)) {
      continue
    }

    const price = readObjectField(item, 'price')
    const priceId = price ? readStringField(price, 'id') : null
    if (priceId) {
      priceIds.push(priceId)
    }
  }

  return priceIds
}

const readNumberField = (record: JsonObject, key: string): number | null => {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Convert a Stripe `cents` field from an event payload into our
 * internal `decimillicents` unit (1 cent = 100_000 decimillicents).
 *
 * Stripe amounts are non-negative integer minor units, but the
 * handler still has to defend against:
 *   - NaN / Infinity (filtered by readNumberField, but belt-and-
 *     suspenders in case the caller bypasses it).
 *   - Fractional cents (fail loudly — we've never seen this from
 *     Stripe but a schema drift would corrupt the bigint ledger).
 *   - Negative cents (a refund-shaped event reaching a credit
 *     path would apply as a positive debit with flipped sign).
 *   - `cents * 100_000` overflowing `Number.MAX_SAFE_INTEGER`
 *     (9.007e15). The worst case is ~$900M in cents; Stripe's
 *     enterprise cap is right at that edge, so the multiplication
 *     is done with BigInt and the result range-checked before
 *     narrowing to Number for the bigint column.
 *
 * Returns `null` when the field is missing or malformed so the
 * caller can branch the same way it does with `readNumberField`.
 */
const readCentsAsDecimillicents = (
  record: JsonObject,
  key: string
): number | null => {
  const cents = readNumberField(record, key)
  if (cents === null) { return null }
  if (!Number.isInteger(cents) || cents < 0) { return null }
  const asDmc = BigInt(cents) * 100_000n
  if (asDmc > BigInt(Number.MAX_SAFE_INTEGER)) { return null }
  return Number(asDmc)
}

const validateOptionalDecimillicentSetting = (
  label: string,
  value: number | null | undefined,
  min: number,
  max?: number
): CoreError | null => {
  if (value === undefined || value === null) {
    return null
  }
  if (
    !Number.isFinite(value)
    || !Number.isInteger(value)
    || !Number.isSafeInteger(value)
    || value < min
    || (max !== undefined && value > max)
  ) {
    const range = max === undefined
      ? `>= ${min.toString()}`
      : `between ${min.toString()} and ${max.toString()}`
    return badRequest(`${label} must be an integer ${range} decimillicents, got ${String(value)}`)
  }
  return null
}

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 1

const isSafeNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0

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

const parseSubscriptionPlan = (value: string | null): SubscriptionPlanSlug | null => {
  if (value === null) {
    return null
  }

  switch (value) {
    case 'try_me':
    case 'pro':
    case 'agency':
      return value
    default:
      return null
  }
}

const toDateFromUnixSeconds = (value: number | null): Date | null =>
  typeof value === 'number' ? new Date(value * 1000) : null

const toLocalStripeSuffix = (organizationId: string): string =>
  organizationId.replaceAll('-', '')

const isLocalStripeCustomerId = (customerId: string | null | undefined): customerId is string =>
  typeof customerId === 'string' && customerId.startsWith('cus_local_')

const ensureStripeCustomerId = (input: {
  readonly billingStore: Effect.Effect.Success<typeof BillingStorePort>
  readonly stripe: Effect.Effect.Success<typeof StripePort>
  readonly organizationId: string
  readonly principalEmail: string
  readonly currentCustomerId: string | null
}) =>
  Effect.gen(function* () {
    if (input.currentCustomerId && !isLocalStripeCustomerId(input.currentCustomerId)) {
      return input.currentCustomerId
    }

    const newCustomer = yield* input.stripe.createCustomer({
      organizationId: input.organizationId,
      email: input.principalEmail
    }).pipe(Effect.mapError((cause) => badRequest('Failed to create Stripe customer', cause)))

    if (input.currentCustomerId === null) {
      const claimedOpt = yield* input.billingStore.claimStripeCustomerId({
        organizationId: input.organizationId,
        stripeCustomerId: newCustomer.id
      }).pipe(Effect.mapError((cause) => badRequest('Failed to update billing customer reference', cause)))

      return Option.getOrElse(claimedOpt, () => newCustomer.id)
    }

    const updatedOpt = yield* input.billingStore.updateSubscriptionFields({
      organizationId: input.organizationId,
      stripeCustomerId: newCustomer.id
    }).pipe(Effect.mapError((cause) => badRequest('Failed to replace local Stripe customer reference', cause)))

    return yield* Option.match(updatedOpt, {
      onNone: () => Effect.fail(notFound('Organization not found')),
      onSome: (updated) => Effect.succeed(updated.stripeCustomerId ?? newCustomer.id)
    })
  })

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
      Effect.mapError((cause) => unauthorized('Failed to verify organization membership', cause)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(unauthorized('Not allowed to access this organization')),
        onSome: Effect.succeed
      }))
    )

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
    getNoCapReminderPreference: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<NoCapReminderPreference, CoreError, BillingStorePort | BillingUiPreferenceStorePort>
    dismissNoCapReminder: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<NoCapReminderPreference, CoreError, BillingStorePort | BillingUiPreferenceStorePort>
    getAutoRechargeRequiresActionChallenge: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<
      AutoRechargeRequiresActionChallenge | null,
      CoreError,
      BillingStorePort | AutoRechargeAttemptStorePort
    >
    createCheckoutSession: (
      principal: { userId: string; email: string },
      input: CreateCheckoutSessionCommand
    ) => Effect.Effect<
      { id: string; url: string },
      CoreError,
      BillingStorePort | StripePort
    >
    completeLocalBillingSetup: (
      principal: { userId: string; email: string },
      organizationId: string,
      input: CompleteLocalBillingSetupCommand
    ) => Effect.Effect<
      BillingSettings,
      CoreError,
      BillingStorePort | CreditServicePort | ClockPort
    >
    createPortalSession: (
      principal: { userId: string },
      input: CreatePortalSessionCommand
    ) => Effect.Effect<
      { id: string; url: string },
      CoreError,
      BillingStorePort | StripePort
    >
    createTopUpSession: (
      principal: { userId: string; email: string },
      input: CreateTopUpSessionCommand
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
      | BillingStorePort
      | StripePort
      | SubscriptionEventStorePort
      | ClockPort
      | ProcessedStripeEventStorePort
      | CreditLedgerStorePort
      | CreditServicePort
      | AutoRechargeAttemptStorePort
    >
    recordUsage: (input: RecordUsageCommand) => Effect.Effect<
      UsageRecord,
      CoreError,
      BillingStorePort | UsageStorePort | BillingGuardPort | ClockPort
    >
    /**
     * Record a usage row from a {@link CostResult}. Maps the customer-facing
     * `marginCostInCreditsDecimillicents` (which already has the spec'd 1.10x
     * margin baked in via integer basis points) into
     * `unit_cost_decimillicents` with `quantity = 1`, then delegates to
     * {@link recordUsage} so the existing INV-BILLING-008 monthly cap
     * increment and immutable usage-record audit path still fire.
     *
     * Use this at every call site where the AI service holds an OpenRouter
     * `CostResult` — it eliminates the latent drift surface where callers
     * had to manually pull `marginCostInCreditsDecimillicents` out of the
     * cost object and pass it as an inline `unitCost` param.
     *
     * @spec billing-and-pricing-design §"Cost recording"
     * @spec INV-BILLING-006 — margin is applied at CostResult creation time.
     * @spec INV-BILLING-008 — usage records drive the monthly cap increment.
     */
    recordUsageFromCostResult: (input: {
      organizationId: string
      category: UsageCategory
      cost: CostResult
      referenceId?: string | null
      metadata?: JsonObject
    }) => Effect.Effect<
      UsageRecord,
      CoreError,
      BillingStorePort | UsageStorePort | BillingGuardPort | ClockPort
    >
    getUsageSummary: (
      principal: { userId: string },
      input: UsageSummaryCommand
    ) => Effect.Effect<UsageSummary, CoreError, BillingStorePort | UsageStorePort | BillingGuardPort>
    /**
     * Execute the off-session auto-recharge loop. Looks up the org's saved
     * Stripe customer + payment method, calls the StripePort's off-session
     * PaymentIntent with the attempt id as the idempotency key, updates the
     * `auto_recharge_attempts` row, and (on success) credits the ledger via
     * {@link CreditServicePort.creditsRecharged} which atomically emits the
     * `billing.credits_recharged` outbox event.
     *
     * Missing payment method is a normal failure (returns `status: 'failed'`)
     * — not an exception. Card declines and SCA requirements land as
     * `'failed'` / `'requires_action'` respectively.
     *
     * @spec billing-and-pricing-design
     * @spec INV-BILLING-009 — atomic ledger commit path via creditsRecharged.
     */
    chargeAutoRecharge: (input: {
      organizationId: string
      attemptId: string
      amountDecimillicents: number
    }) => Effect.Effect<
      {
        status: 'succeeded' | 'failed' | 'requires_action'
        stripePaymentIntentId: string
        failureReason: string | null
      },
      CoreError,
      BillingStorePort | StripePort | CreditServicePort | AutoRechargeAttemptStorePort
    >
  }
>() {}

/**
 * Top-level helper that exercises the recordUsage path (subscription
 * guard → idempotency lookup → immutable local usage record).
 * Lifted out of the `BillingServiceLive` object literal so both
 * `recordUsage` and `recordUsageFromCostResult` can call it without a
 * circular self-reference inside the literal initializer.
 *
 * The helper takes the same `RecordUsageCommand` shape as the public
 * `recordUsage` method and returns the same Effect, so wrapping it is
 * a single property assignment.
 */
const runRecordUsageEffect = (
  input: RecordUsageCommand
): Effect.Effect<
  UsageRecord,
  CoreError,
  BillingStorePort | UsageStorePort | BillingGuardPort | ClockPort
> =>
  Effect.gen(function* () {
    const billingStore = yield* BillingStorePort
    const usageStore = yield* UsageStorePort
    const guard = yield* BillingGuardPort
    const clock = yield* ClockPort

    // Defensive validation at the service seam. The public
    // `recordUsageInputSchema` pins these at the HTTP boundary, but
    // `recordUsageFromCostResult` (and any future direct core caller)
    // bypasses the schema, so pin again here. NaN/Infinity slip
    // through naive `< 1` / `< 0` comparisons because NaN < X is
    // always false — a poisoned input would reach usage_records and
    // corrupt the monthly cap increment downstream.
    if (!isPositiveSafeInteger(input.quantity)) {
      return yield* Effect.fail(badRequest(
        `recordUsage: quantity must be a positive integer <= Number.MAX_SAFE_INTEGER, got ${String(input.quantity)}`
      ))
    }
    if (!isSafeNonNegativeInteger(input.unitCostDecimillicents)) {
      return yield* Effect.fail(badRequest(
        `recordUsage: unitCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.unitCostDecimillicents)}`
      ))
    }
    // Overflow guard: quantity * unitCost is a plain Number
    // multiplication, so for very large token counts (quantity in
    // the millions) paired with a non-trivial unit cost the product
    // could exceed Number.MAX_SAFE_INTEGER and silently round. Use
    // BigInt to detect overflow before it lands on the bigint column
    // as a truncated float.
    const totalCostBigInt = BigInt(input.quantity) * BigInt(input.unitCostDecimillicents)
    if (totalCostBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      return yield* Effect.fail(badRequest(
        `recordUsage: quantity * unitCostDecimillicents exceeds MAX_SAFE_INTEGER (${totalCostBigInt.toString()})`
      ))
    }

    const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
      Effect.mapError((cause) => badRequest('Failed to fetch billing settings', cause)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(notFound('Organization not found')),
        onSome: Effect.succeed
      }))
    )

    const guardEnabled = yield* guard.isEnabled()
    if (!isSubscriptionGuardSatisfied(
      { subscriptionStatus: settings.subscriptionStatus, isSubscribed: settings.isSubscribed },
      guardEnabled
    )) {
      return yield* Effect.fail(unauthorized('Active subscription required'))
    }

    if (input.referenceId) {
      const existingOpt = yield* usageStore.findByReferenceId(input.organizationId, input.referenceId).pipe(
        Effect.mapError((cause) => badRequest('Failed to look up usage reference', cause))
      )

      if (Option.isSome(existingOpt)) {
        return existingOpt.value
      }
    }

    // Safe because the BigInt overflow guard above asserted the
    // product fits in Number.MAX_SAFE_INTEGER.
    const totalCostDecimillicents = Number(totalCostBigInt)
    const recordedAt = yield* clock.now()

    const recorded = yield* usageStore.record({
      organizationId: input.organizationId,
      category: input.category,
      quantity: input.quantity,
      unitCostDecimillicents: input.unitCostDecimillicents,
      totalCostDecimillicents,
      referenceId: input.referenceId ?? null,
      stripeUsageRecordId: null,
      metadata: input.metadata ?? {},
      recordedAt
    }).pipe(
      Effect.mapError((cause) => badRequest('Failed to record usage', cause)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(badRequest('Failed to record usage')),
        onSome: Effect.succeed
      }))
    )

    return recorded
  })

export const BillingServiceLive = Layer.effect(
  BillingService,
  Effect.succeed({
    getBillingSettings: (principal, organizationId) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(organizationId, principal, false)
        const billingStore = yield* BillingStorePort

        const settings = yield* billingStore.getSubscriptionFields(organizationId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch billing settings', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        return toBillingSettings(settings)
      }),

    updateBillingSettings: (principal, organizationId, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(organizationId, principal, true)
        const billingStore = yield* BillingStorePort

        const settingError =
          validateOptionalDecimillicentSetting(
            'autoRechargeThresholdDecimillicents',
            input.autoRechargeThresholdDecimillicents,
            AUTO_RECHARGE_THRESHOLD_MIN_DECIMILLICENTS,
            AUTO_RECHARGE_THRESHOLD_MAX_DECIMILLICENTS
          )
          ?? validateOptionalDecimillicentSetting(
            'autoRechargeAmountDecimillicents',
            input.autoRechargeAmountDecimillicents,
            AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS,
            AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS
          )
          ?? validateOptionalDecimillicentSetting(
            'usageCapDecimillicents',
            input.usageCapDecimillicents,
            0
          )
        if (settingError) {
          return yield* Effect.fail(settingError)
        }

        // Semantic consistency: an enabled auto-recharge row requires
        // BOTH a non-null threshold AND a non-null amount. Without
        // these, the worker's `runAutoRechargeTrigger` silently no-ops
        // on every low-balance signal (see amount <= 0 guard in
        // apps/worker/src/billing-activities.ts) — the user sees
        // "auto-recharge enabled" in the UI, their card never gets
        // charged, they burn through their credits, and are then
        // suspended. Compute the post-patch state and reject the update
        // if it would produce an inconsistent row, including patches
        // that clear amount/threshold while the existing row is already
        // enabled.
        //
        // Partial updates: if a field is undefined in the patch the
        // existing value stays, so we need the current org row to
        // merge.
        const touchesAutoRechargeState =
          input.autoRechargeEnabled !== undefined
          || input.autoRechargeThresholdDecimillicents !== undefined
          || input.autoRechargeAmountDecimillicents !== undefined
        if (touchesAutoRechargeState) {
          const currentOpt = yield* billingStore.getSubscriptionFields(organizationId).pipe(
            Effect.mapError((cause) => badRequest('Failed to fetch billing settings', cause))
          )
          if (Option.isNone(currentOpt)) {
            return yield* Effect.fail(notFound('Organization not found'))
          }
          const current = currentOpt.value
          const nextEnabled = input.autoRechargeEnabled ?? current.autoRechargeEnabled
          // A patch `null` value clears the field; `undefined` keeps it.
          const nextThreshold = input.autoRechargeThresholdDecimillicents === undefined
            ? current.autoRechargeThreshold
            : input.autoRechargeThresholdDecimillicents
          const nextAmount = input.autoRechargeAmountDecimillicents === undefined
            ? current.autoRechargeAmount
            : input.autoRechargeAmountDecimillicents
          if (nextEnabled && (nextThreshold === null || nextAmount === null)) {
            return yield* Effect.fail(badRequest(
              'Enabling auto-recharge requires both autoRechargeThresholdDecimillicents and autoRechargeAmountDecimillicents to be set'
            ))
          }
        }

        const updated = yield* billingStore.updateBillingSettings({
          organizationId,
          billingEmail: input.billingEmail,
          autoRechargeEnabled: input.autoRechargeEnabled,
          autoRechargeThreshold: input.autoRechargeThresholdDecimillicents,
          autoRechargeAmount: input.autoRechargeAmountDecimillicents,
          usageCap: input.usageCapDecimillicents
        }).pipe(
          Effect.mapError((cause) => badRequest('Failed to update billing settings', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        return toBillingSettings(updated)
      }),

    getNoCapReminderPreference: (principal, organizationId) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(organizationId, principal, true)
        const preferenceStore = yield* BillingUiPreferenceStorePort

        const dismissed = yield* preferenceStore
          .isNoCapReminderDismissed(principal.userId, organizationId)
          .pipe(
            Effect.mapError((cause) => badRequest('Failed to fetch no-cap reminder preference', cause))
          )

        return { dismissed }
      }),

    dismissNoCapReminder: (principal, organizationId) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(organizationId, principal, true)
        const preferenceStore = yield* BillingUiPreferenceStorePort

        yield* preferenceStore
          .dismissNoCapReminder(principal.userId, organizationId)
          .pipe(
            Effect.mapError((cause) => badRequest('Failed to dismiss no-cap reminder', cause))
          )

        return { dismissed: true }
      }),

    getAutoRechargeRequiresActionChallenge: (principal, organizationId) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(organizationId, principal, true)
        const attemptStore = yield* AutoRechargeAttemptStorePort

        return yield* attemptStore
          .findLatestRequiresActionChallenge(organizationId)
          .pipe(
            Effect.mapError((cause) => badRequest('Failed to fetch auto-recharge 3DS challenge', cause))
          )
      }),

    createCheckoutSession: (principal, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(input.organizationId, principal, true)
        const billingStore = yield* BillingStorePort
        const stripe = yield* StripePort

        const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch billing settings', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        const portalBillingEmail =
          typeof settings.billingEmail === 'string' && settings.billingEmail.length > 0
            ? settings.billingEmail
            : `billing+${toLocalStripeSuffix(input.organizationId)}@example.com`

        const customerId = yield* ensureStripeCustomerId({
          billingStore,
          stripe,
          organizationId: input.organizationId,
          principalEmail: portalBillingEmail,
          currentCustomerId: settings.stripeCustomerId
        })

        return yield* stripe.createCheckoutSession({
          ...input,
          customerId
        }).pipe(Effect.mapError((cause) => badRequest('Failed to create checkout session', cause)))
      }),

    completeLocalBillingSetup: (principal, organizationId, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(organizationId, principal, true)
        const billingStore = yield* BillingStorePort
        const creditService = yield* CreditServicePort
        const clock = yield* ClockPort

        const current = yield* billingStore.getSubscriptionFields(organizationId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch billing settings', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        const now = yield* clock.now()
        const localStripeSuffix = toLocalStripeSuffix(organizationId)
        const nextSubscriptionId =
          current.stripeSubscriptionId && !current.stripeSubscriptionId.startsWith('sub_local_')
            ? current.stripeSubscriptionId
            : `sub_local_${input.subscriptionPlan}_${localStripeSuffix}`

        yield* billingStore.updateSubscriptionFields({
          organizationId,
          billingEmail: current.billingEmail ?? principal.email,
          stripeCustomerId: current.stripeCustomerId ?? `cus_local_${localStripeSuffix}`,
          stripeSubscriptionId: nextSubscriptionId,
          stripePaymentMethodId: current.stripePaymentMethodId ?? `pm_local_${localStripeSuffix}`,
          stripeMeteredSubscriptionItemId: null,
          isSubscribed: true,
          subscriptionStatus: 'active',
          subscriptionPlan: input.subscriptionPlan,
          subscriptionStartedAt: current.subscriptionStartedAt ?? now,
          subscriptionEndsAt: null,
          subscriptionCurrentPeriodEnd: new Date(now.getTime() + LOCAL_DEV_SUBSCRIPTION_PERIOD_MS),
          paymentGracePeriodEndsAt: null
        }).pipe(
          Effect.mapError((cause) => badRequest('Failed to persist local billing bootstrap state', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        yield* creditService.creditsPurchased({
          organizationId,
          amountDecimillicents: WELCOME_CREDIT_DECIMILLICENTS[input.subscriptionPlan],
          stripeEventId: `evt_local_welcome_credit_${localStripeSuffix}`,
          referenceId: `dev:local-welcome-credit:${organizationId}`,
          reason: 'Local development welcome credit'
        })

        const refreshed = yield* billingStore.getSubscriptionFields(organizationId).pipe(
          Effect.mapError((cause) => badRequest('Failed to reload billing settings', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        return toBillingSettings(refreshed)
      }),

    createPortalSession: (principal, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(input.organizationId, principal, true)
        const billingStore = yield* BillingStorePort
        const stripe = yield* StripePort
        const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch billing settings', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        const portalBillingEmail =
          typeof settings.billingEmail === 'string' && settings.billingEmail.length > 0
            ? settings.billingEmail
            : `billing+${toLocalStripeSuffix(input.organizationId)}@example.com`

        const customerId = yield* ensureStripeCustomerId({
          billingStore,
          stripe,
          organizationId: input.organizationId,
          principalEmail: portalBillingEmail,
          currentCustomerId: settings.stripeCustomerId
        })

        return yield* stripe.createPortalSession({
          ...input,
          customerId
        }).pipe(Effect.mapError((cause) => badRequest('Failed to create billing portal session', cause)))
      }),

    createTopUpSession: (principal, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(input.organizationId, principal, true)

        // Defence-in-depth bounds check: the HTTP schema enforces these
        // via TOP_UP_MIN/MAX_DECIMILLICENTS, but assert at the service
        // seam too so a future caller that bypasses the schema (e.g.
        // an admin CLI, a future internal API) can't slip past. Pull
        // the constants directly from @tx-agent-kit/contracts so the
        // two bounds never drift.
        //
        // @spec billing-and-pricing-design §"Top-up bounds"
        if (!Number.isInteger(input.amountDecimillicents)) {
          return yield* Effect.fail(badRequest('Top-up amount must be an integer number of decimillicents'))
        }
        if (input.amountDecimillicents < TOP_UP_MIN_DECIMILLICENTS) {
          return yield* Effect.fail(badRequest(
            `Top-up amount below minimum ${TOP_UP_MIN_DECIMILLICENTS.toString()} decimillicents (1 cent)`
          ))
        }
        if (input.amountDecimillicents > TOP_UP_MAX_DECIMILLICENTS) {
          return yield* Effect.fail(badRequest(
            `Top-up amount above maximum ${TOP_UP_MAX_DECIMILLICENTS.toString()} decimillicents ($500)`
          ))
        }

        const billingStore = yield* BillingStorePort
        const stripe = yield* StripePort

        const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch billing settings', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        // Lazily claim a Stripe customer if the org doesn't have one yet —
        // mirrors the createCheckoutSession path so top-up works on
        // orgs that have never started a subscription.
        const customerId = yield* ensureStripeCustomerId({
          billingStore,
          stripe,
          organizationId: input.organizationId,
          principalEmail: principal.email,
          currentCustomerId: settings.stripeCustomerId
        })

        return yield* stripe.createTopUpSession({
          organizationId: input.organizationId,
          customerId,
          amountDecimillicents: input.amountDecimillicents,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl
        }).pipe(Effect.mapError((cause) => badRequest('Failed to create top-up session', cause)))
      }),

    processWebhookEvent: (rawBody, signature) =>
      Effect.gen(function* () {
        const stripe = yield* StripePort
        const eventStore = yield* SubscriptionEventStorePort
        const billingStore = yield* BillingStorePort
        const clock = yield* ClockPort
        const processedStripeEventStore = yield* ProcessedStripeEventStorePort
        const creditLedgerStore = yield* CreditLedgerStorePort
        const creditService = yield* CreditServicePort
        const attemptStore = yield* AutoRechargeAttemptStorePort

        const event = yield* stripe.constructWebhookEvent(rawBody, signature).pipe(
          Effect.mapError((cause) => badRequest('Invalid Stripe webhook signature', cause))
        )

        // @spec INV-BILLING-005 — primary idempotency gate. Atomic
        // INSERT ... ON CONFLICT DO NOTHING: if the row already exists this
        // returns false and we early-exit before any state-mutating work.
        const inserted = yield* processedStripeEventStore.tryInsert(event.id).pipe(
          Effect.mapError((cause) => badRequest('Failed to claim processed_stripe_events row', cause))
        )

        if (!inserted) {
          return {
            processed: true as const,
            idempotent: true as const,
            eventId: event.id
          }
        }

        // @spec INV-BILLING-005 — the tryInsert above committed in its own
        // transaction. If the rest of this handler fails, a naïve retry
        // would hit the claim row and silently short-circuit as
        // `idempotent: true`, losing the state mutation that never
        // happened. Release the claim on failure so Stripe's retry
        // re-runs the handler end-to-end.
        const releaseClaim = processedStripeEventStore.deleteByEventId(event.id).pipe(Effect.ignore)

        return yield* Effect.gen(function* () {
        // Secondary audit log: subscription_events is still written as the
        // human-readable history of processed Stripe events. It is no longer
        // the primary idempotency gate — processed_stripe_events (above) is.
        const existingEventOpt = yield* eventStore.findByStripeEventId(event.id).pipe(
          Effect.mapError((cause) => badRequest('Failed to check webhook audit log', cause))
        )

        const resolveBySubscriptionId = (subscriptionId: string): Effect.Effect<string | null, CoreError> =>
          billingStore
            .findByStripeSubscriptionId(subscriptionId)
            .pipe(
              Effect.mapError((cause) => badRequest('Failed to resolve organization for subscription webhook', cause)),
              Effect.map((opt) => Option.isSome(opt) ? opt.value.id : null)
            )

        const resolveByCustomerId = (customerId: string): Effect.Effect<string | null, CoreError> =>
          billingStore
            .findByStripeCustomerId(customerId)
            .pipe(
              Effect.mapError((cause) => badRequest('Failed to resolve organization for customer webhook', cause)),
              Effect.map((opt) => Option.isSome(opt) ? opt.value.id : null)
            )

        const organizationId = yield* resolveOrganizationIdForEvent(
          event.data.object,
          resolveBySubscriptionId,
          resolveByCustomerId
        )
        const eventMetadata = readObjectField(event.data.object, 'metadata') ?? null
        const autoRechargeAttemptId = eventMetadata
          ? readStringField(eventMetadata, 'autoRechargeAttemptId')
          : null
        const autoRechargeIntentCompleted =
          event.type === 'payment_intent.succeeded'
          && autoRechargeAttemptId !== null

        // Fail early for state-mutating event types when organizationId is unresolvable.
        // Returning an error (non-2xx) causes Stripe to retry the webhook later, when the
        // organization may be resolvable (e.g., after a checkout.session.completed arrives
        // first and links the Stripe customer). Without this guard the event would be
        // marked as processed with no state written — silent data loss.
        const stateMutatingEventTypes = new Set([
          'checkout.session.completed',
          'customer.subscription.created',
          'customer.subscription.updated',
          'customer.subscription.deleted',
          'invoice.payment_failed',
          'invoice.payment_succeeded',
          'charge.dispute.created',
          'charge.dispute.closed',
          'charge.refunded'
        ])

        if (!organizationId && (stateMutatingEventTypes.has(event.type) || autoRechargeIntentCompleted)) {
          return yield* Effect.fail(
            badRequest(`Cannot process ${event.type} webhook: unable to resolve organizationId`)
          )
        }

        const existingEvent = Option.getOrUndefined(existingEventOpt)
        const createdEvent = existingEvent ?? (yield* eventStore.create({
          stripeEventId: event.id,
          eventType: event.type,
          organizationId,
          payload: event.payload
        }).pipe(
          Effect.mapError((cause) => badRequest('Failed to persist webhook event', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Failed to persist webhook event')),
            onSome: Effect.succeed
          }))
        ))

        // Audit-log bookkeeping: stamp subscription_events.processed_at.
        // Fire-and-forget — `processed_stripe_events.tryInsert` above is
        // the authoritative idempotency gate. Gating on this as well would
        // strand retries: if this attempt succeeds markProcessed but then
        // the handler fails, the released processed_stripe_events claim
        // lets Stripe retry, but the stale processed_at would wrongly
        // short-circuit the retry as idempotent. See INV-BILLING-005 and
        // billing-webhook-claim-rollback.e2e.
        yield* eventStore.markProcessed(createdEvent.id).pipe(
          Effect.mapError((cause) => badRequest('Failed to stamp webhook audit log', cause)),
          Effect.ignore
        )

        if (organizationId) {
          if (event.type === 'checkout.session.completed') {
            const checkoutMode = readStringField(event.data.object, 'mode')
            const amountDecimillicents = readCentsAsDecimillicents(event.data.object, 'amount_total')
            // @spec INV-BILLING-005 — validate one-time payment checkouts
            // before any local billing field updates. A malformed top-up
            // webhook must fail closed without partially linking a Stripe
            // customer, payment method, subscription id, or plan while the
            // processed_stripe_events claim is released for retry.
            if (
              checkoutMode === 'payment'
              && (
                amountDecimillicents === null
                || !isPositiveSafeInteger(amountDecimillicents)
                || amountDecimillicents > TOP_UP_MAX_DECIMILLICENTS
              )
            ) {
              return yield* Effect.fail(
                badRequest(
                  `checkout.session.completed ${event.id} payment mode is missing a usable positive amount_total field within the top-up maximum`
                )
              )
            }
            const paymentMethodId = readStringField(event.data.object, 'payment_method')
            const checkoutSubscriptionId = checkoutMode === 'payment'
              ? null
              : readStringField(event.data.object, 'subscription')
            const checkoutPlan = checkoutMode === 'payment'
              ? null
              : parseSubscriptionPlan(
                readStringField(readObjectField(event.data.object, 'metadata') ?? {}, 'subscriptionPlan')
              )
            // CRITICAL: a top-up checkout (mode=payment) has no
            // subscription field on the session, so reading it returns
            // null. The previous handler unconditionally set
            // stripeSubscriptionId to that null, which WIPED the active
            // subscription pointer for any user that topped up while
            // subscribed. Never persist subscription ids or plans from
            // payment-mode top-ups; only subscription-mode checkouts own
            // those fields.
            yield* billingStore.updateSubscriptionFields({
              organizationId,
              stripeCustomerId: readStringField(event.data.object, 'customer'),
              ...(checkoutSubscriptionId !== null
                ? { stripeSubscriptionId: checkoutSubscriptionId }
                : {}),
              ...(checkoutPlan !== null
                ? { subscriptionPlan: checkoutPlan }
                : {}),
              ...(paymentMethodId !== null ? { stripePaymentMethodId: paymentMethodId } : {})
            }).pipe(Effect.mapError((cause) => badRequest('Failed to persist checkout webhook state', cause)))

            // @spec INV-BILLING-005 — only one-time payment checkouts grant
            // credits. Subscription-mode checkouts are handled by the
            // recurring invoice.payment_succeeded pathway (intentionally
            // excluded here so existing subscription tests are unaffected).
            if (checkoutMode === 'payment') {
              const purchaseAmountDecimillicents = amountDecimillicents
              if (purchaseAmountDecimillicents === null) {
                return yield* Effect.fail(
                  badRequest(
                    `checkout.session.completed ${event.id} payment mode is missing a usable positive amount_total field`
                  )
                )
              }
              yield* creditService.creditsPurchased({
                organizationId,
                amountDecimillicents: purchaseAmountDecimillicents,
                stripeEventId: event.id,
                referenceId: `stripe:checkout:${event.id}`,
                reason: 'Credit purchase via Stripe checkout'
              })
            }
          } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
            const status = parseSubscriptionStatus(readStringField(event.data.object, 'status')) ?? 'inactive'
            const startDate = toDateFromUnixSeconds(readNumberField(event.data.object, 'start_date'))
            const endedAt = toDateFromUnixSeconds(
              readNumberField(event.data.object, 'ended_at') ?? readNumberField(event.data.object, 'cancel_at')
            )
            const currentPeriodEnd = toDateFromUnixSeconds(readNumberField(event.data.object, 'current_period_end'))
            const eventSubscriptionId = readStringField(event.data.object, 'id')
            // Derive the plan slug from the actual line items rather
            // than hardcoding 'pro'. The historical bug was a fixed
            // 'pro' write that caused try_me subscribers to receive
            // the Pro welcome credit ($20 instead of $9) and agency
            // subscribers to receive less than they were owed
            // ($20 instead of $45). The resolver returns 'pro' as a
            // safe default when no configured price id matches.
            // Webhook ordering tolerance: gate on the event's sub id
            // matching the org's current stripe_subscription_id when
            // one is set. Applies to BOTH .created and .updated:
            //
            //   - .updated: also gated by `onlyIfStatusIn` excluding
            //     canceled (the resurrection guard from ba78366).
            //   - .created: protects against a stale .created retry
            //     for an OLD subscription landing after the user has
            //     already started a yet-newer one. Brand-new orgs
            //     and re-subscribe-after-cancel both pass the gate
            //     (current_sub_id is null in those cases — the
            //     `.deleted` handler nulls it on cancel).
            //
            // The sub-id-match gate is necessary because Stripe's
            // at-least-once delivery + retries can ship a `.created`
            // or `.updated` from an OLD subscription long after the
            // user has cancelled and started a fresh one, and the
            // unconditional handler would clobber the active sub's row.
            let staleUpdate = false
            const currentSettingsOpt = yield* billingStore
              .getSubscriptionFields(organizationId)
              .pipe(Effect.mapError((cause) => badRequest('Failed to read settings for subscription gate', cause)))
            const currentSubscriptionId = Option.match(currentSettingsOpt, {
              onNone: () => null,
              onSome: (s) => s.stripeSubscriptionId
            })
            if (eventSubscriptionId === null) {
              return yield* Effect.fail(
                badRequest(`${event.type} ${event.id} is missing a usable subscription id`)
              )
            }
            const currentSubscriptionPlan = Option.match(currentSettingsOpt, {
              onNone: () => null,
              onSome: (s) => parseSubscriptionPlan(s.subscriptionPlan)
            })
            const planFromEvent = parseSubscriptionPlan(
              readStringField(readObjectField(event.data.object, 'metadata') ?? {}, 'subscriptionPlan')
            )
            const subscriptionPriceIds = collectSubscriptionPriceIds(event.data.object)
            const resolvedPlan = planFromEvent
              ?? currentSubscriptionPlan
              ?? stripe.resolvePlanFromPriceIds(subscriptionPriceIds)
            if (
              currentSubscriptionId !== null
              && eventSubscriptionId !== currentSubscriptionId
            ) {
              yield* Effect.logWarning(
                `${event.type} ${event.id} for stale sub id ${eventSubscriptionId}; current is ${currentSubscriptionId} — ignoring`
              )
              staleUpdate = true
            }

            if (!staleUpdate) {
              const updateOrderingGuard =
                event.type === 'customer.subscription.updated'
                  ? {
                      onlyIfStatusIn: [
                        'active',
                        'trialing',
                        'past_due',
                        'unpaid',
                        'paused',
                        'inactive'
                      ] as const
                    }
                  : {}

              yield* billingStore.updateSubscriptionFields({
                organizationId,
                stripeCustomerId: readStringField(event.data.object, 'customer'),
                stripeSubscriptionId: eventSubscriptionId,
                stripeMeteredSubscriptionItemId: null,
                isSubscribed: canAccessFeature(resolvedPlan, status, 'free'),
                subscriptionStatus: status,
                subscriptionPlan: resolvedPlan,
                subscriptionStartedAt: startDate,
                subscriptionEndsAt: endedAt,
                subscriptionCurrentPeriodEnd: currentPeriodEnd,
                ...updateOrderingGuard
              }).pipe(Effect.mapError((cause) => badRequest('Failed to persist subscription webhook state', cause)))
            }
          } else if (event.type === 'customer.subscription.deleted') {
            // Gate on the event's subscription id matching the org's
            // current stripe_subscription_id. A late-delivered .deleted
            // for an OLD subscription (the user canceled + re-subscribed
            // out-of-order from Stripe's perspective) would otherwise
            // wipe out the newer active sub's row. Same pattern as the
            // .updated guard in ba78366 but for cancellation.
            const eventSubscriptionId = readStringField(event.data.object, 'id')
            if (eventSubscriptionId === null) {
              return yield* Effect.fail(
                badRequest(`customer.subscription.deleted ${event.id} is missing a usable subscription id`)
              )
            }
            const currentSettingsOpt = yield* billingStore
              .getSubscriptionFields(organizationId)
              .pipe(Effect.mapError((cause) => badRequest('Failed to read settings for subscription.deleted gate', cause)))
            const currentSubscriptionId = Option.match(currentSettingsOpt, {
              onNone: () => null,
              onSome: (s) => s.stripeSubscriptionId
            })
            if (
              currentSubscriptionId !== null
              && eventSubscriptionId !== currentSubscriptionId
            ) {
              // Stale delete for a previous subscription — drop on the
              // floor. The current sub stays intact. Effect's default
              // logger surfaces the warning without needing a console
              // import in this pure-service layer.
              yield* Effect.logWarning(
                `customer.subscription.deleted ${event.id} for stale sub id ${eventSubscriptionId}; current is ${currentSubscriptionId} — ignoring`
              )
            } else {
              const endedAt = toDateFromUnixSeconds(
                readNumberField(event.data.object, 'ended_at') ?? readNumberField(event.data.object, 'cancel_at')
              ) ?? (yield* clock.now())
              yield* billingStore.updateSubscriptionFields({
                organizationId,
                isSubscribed: false,
                subscriptionStatus: 'canceled',
                subscriptionEndsAt: endedAt,
                stripeSubscriptionId: null,
                stripeMeteredSubscriptionItemId: null
              }).pipe(Effect.mapError((cause) => badRequest('Failed to persist cancellation webhook state', cause)))
            }
          } else if (event.type === 'payment_intent.succeeded' && autoRechargeAttemptId !== null) {
            const stripePaymentIntentId = readStringField(event.data.object, 'id')
            const amountDecimillicents =
              readCentsAsDecimillicents(event.data.object, 'amount_received')
              ?? readCentsAsDecimillicents(event.data.object, 'amount')

            if (
              !stripePaymentIntentId
              || amountDecimillicents === null
              || amountDecimillicents <= 0
              || amountDecimillicents > AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS
            ) {
              return yield* Effect.fail(
                badRequest(
                  `payment_intent.succeeded ${event.id} is missing a usable payment_intent id or bounded amount for auto-recharge reconciliation`
                )
              )
            }

            // Mirror chargeAutoRecharge's ordering: Stripe has already
            // settled, but the local wallet credit is the state that
            // matters for the user. If crediting fails, keep the
            // requires-action attempt non-terminal and release the
            // processed_stripe_events claim so Stripe redelivery can retry
            // the idempotent credit append and then mark success.
            yield* creditService.creditsRecharged({
              organizationId,
              amountDecimillicents,
              stripePaymentIntentId,
              stripeEventId: event.id,
              referenceId: `stripe:auto-recharge:${autoRechargeAttemptId}`,
              reason: 'Auto-recharge'
            })

            yield* attemptStore
              .markAttemptSucceeded(autoRechargeAttemptId, stripePaymentIntentId)
              .pipe(Effect.mapError((cause) => badRequest('Failed to persist auto-recharge webhook attempt state', cause)))
          } else if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_succeeded') {
            // Gate invoice.* events on the invoice's subscription id
            // matching the org's current stripe_subscription_id. A
            // stale invoice retry from a PREVIOUS subscription would
            // otherwise corrupt the current active sub's status (the
            // .updated/.deleted gates only protect their own event
            // type — invoice.* writes have a separate code path). The
            // invoice carries the subscription id in
            // event.data.object.subscription.
            const invoiceSubscriptionId = readStringField(event.data.object, 'subscription')
            const currentSettingsOpt = yield* billingStore
              .getSubscriptionFields(organizationId)
              .pipe(Effect.mapError((cause) => badRequest('Failed to read settings for invoice gate', cause)))
            const currentSubscriptionId = Option.match(currentSettingsOpt, {
              onNone: () => null,
              onSome: (s) => s.stripeSubscriptionId
            })
            const currentSubscriptionStatus = Option.match(currentSettingsOpt, {
              onNone: () => null,
              onSome: (s) => s.subscriptionStatus
            })
            if (invoiceSubscriptionId === null) {
              return yield* Effect.fail(
                badRequest(`${event.type} ${event.id} is missing a usable subscription id`)
              )
            }
            if (currentSubscriptionId === null && currentSubscriptionStatus !== 'canceled') {
              return yield* Effect.fail(
                badRequest(
                  `${event.type} ${event.id} arrived before subscription ${invoiceSubscriptionId} was linked locally`
                )
              )
            }
            const staleInvoice =
              currentSubscriptionId !== null
              && invoiceSubscriptionId !== currentSubscriptionId

            if (staleInvoice) {
              yield* Effect.logWarning(
                `${event.type} ${event.id} for stale sub id ${invoiceSubscriptionId}; current is ${currentSubscriptionId} — ignoring`
              )
            } else if (event.type === 'invoice.payment_failed') {
              // @spec billing-and-pricing-design §"Payment Failure Lifecycle"
              // Set `paymentGracePeriodEndsAt` synchronously alongside the
              // status=past_due write so the reserve-time guard at
              // credit-ledger.ts sees a non-null column immediately. Previously
              // the worker's `startPaymentGracePeriod` activity was the sole
              // writer, leaving a short window where the org was past_due but
              // the column was still null — `reserve()` would allow new spend
              // during that window, violating the spec's "operations suspended"
              // rule. The worker activity still runs (sends the notification
              // email + reasserts the column idempotently).
              const gracePeriodEndsAt = new Date(
                (yield* clock.now()).getTime() + PAYMENT_GRACE_PERIOD_MS
              )
              yield* billingStore.updateSubscriptionFields({
                organizationId,
                isSubscribed: true,
                subscriptionStatus: 'past_due',
                paymentGracePeriodEndsAt: gracePeriodEndsAt,
                onlyIfStatusIn: ['active', 'trialing', 'past_due']
              }).pipe(Effect.mapError((cause) => badRequest('Failed to persist failed payment webhook state', cause)))
            } else {
              // @spec billing-and-pricing-design §"Failed Payment Lifecycle"
              // Clear the payment grace period on a successful payment —
              // otherwise the column stays non-null forever and the reserve
              // guard keeps the org blocked even after Stripe confirms the
              // recovery.
              yield* billingStore.updateSubscriptionFields({
                organizationId,
                isSubscribed: true,
                subscriptionStatus: 'active',
                paymentGracePeriodEndsAt: null,
                onlyIfStatusIn: ['active', 'past_due', 'trialing', 'unpaid']
              }).pipe(Effect.mapError((cause) => badRequest('Failed to persist payment success webhook state', cause)))

              // @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
              // @spec INV-BILLING-CREDITS-NEVER-EXPIRE
              // @spec billing-and-pricing-design §"Welcome Credits"
              //
              // On the FIRST successful invoice.payment_succeeded for this
              // org, grant a one-time welcome credit in decimillicents per
              // the plan tier. The guard is `welcome_credit_granted_at IS
              // NULL` on the org row. The underlying creditLedgerStore.append
              // is idempotent via the referenceId `welcome:${orgId}` which
              // is globally unique per org (not per event) — so every future
              // renewal of any invoice converges to a no-op even if the
              // column write falls behind.
              //
              // Welcome credits must NOT be granted on renewal charges.
              // Welcome credits must NOT re-grant on plan upgrade.
              // Welcome credits never expire (no scheduled purge).
              // Welcome credits are refund-forgiven (see charge.refunded
              // handler below — it skips the debit when the charge has
              // an `invoice` field set, i.e. the charge originated from
              // a subscription invoice rather than a top-up PaymentIntent).
              const welcomeGrantedAt = Option.match(currentSettingsOpt, {
                onNone: () => null,
                onSome: (s) => s.welcomeCreditGrantedAt
              })
              const subscriptionPlanSlug = Option.match(currentSettingsOpt, {
                onNone: () => null,
                onSome: (s) => s.subscriptionPlan
              })
              const welcomeAmount: number | null = (() => {
                if (subscriptionPlanSlug === 'try_me') {
                  return WELCOME_CREDIT_DECIMILLICENTS.try_me
                }
                if (subscriptionPlanSlug === 'pro') {
                  return WELCOME_CREDIT_DECIMILLICENTS.pro
                }
                if (subscriptionPlanSlug === 'agency') {
                  return WELCOME_CREDIT_DECIMILLICENTS.agency
                }
                return null
              })()

              if (welcomeGrantedAt === null && welcomeAmount !== null && subscriptionPlanSlug !== null) {
                // Atomic grant: the credit_ledger insert, the
                // billing.welcome_credit_granted outbox event, AND the
                // organizations.welcome_credit_granted_at column stamp
                // all commit inside ONE db.transaction inside the
                // credit-ledger repo. Closes the historical hole
                // where the column was a separate post-write and a
                // crash between the ledger commit and the stamp would
                // leave the column NULL, causing every monthly renewal
                // to re-enter the grant branch (the referenceId guard
                // would still prevent double-granting, but the loop
                // would never converge).
                const grantedAt = yield* clock.now()
                yield* creditLedgerStore
                  .append({
                    organizationId,
                    entryType: 'adjustment',
                    amountDecimillicents: welcomeAmount,
                    reason: 'welcome_credit',
                    // Globally unique per org (not per event) — renewals
                    // collapse to an idempotent no-op via the repo's
                    // referenceId existence check.
                    referenceId: `welcome:${organizationId}`,
                    stripeEventId: event.id,
                    metadata: {
                      plan: subscriptionPlanSlug,
                      source: 'invoice.payment_succeeded'
                    },
                    outboxEvent: {
                      eventType: 'billing.welcome_credit_granted',
                      aggregateType: 'billing',
                      aggregateId: organizationId,
                      payload: {
                        organizationId,
                        amountDecimillicents: welcomeAmount,
                        plan: subscriptionPlanSlug,
                        stripeEventId: event.id
                      },
                      correlationId: null
                    },
                    stampWelcomeCreditAt: grantedAt
                  })
                  .pipe(Effect.mapError((cause) => badRequest('Failed to grant welcome credit', cause)))
              }
            }
          } else if (event.type === 'charge.dispute.created') {
            // @spec INV-BILLING-009 — freeze the org's credit balance by
            // appending a zero-amount `adjustment` ledger row with
            // `dispute_hold` metadata, and atomically emit
            // `billing.dispute_created` via the outbox.
            const chargeAmountDecimillicents = readCentsAsDecimillicents(
              event.data.object,
              'amount'
            )
            if (
              chargeAmountDecimillicents === null
              || !isPositiveSafeInteger(chargeAmountDecimillicents)
            ) {
              return yield* Effect.fail(
                badRequest(
                  `charge.dispute.created ${event.id} is missing a usable positive amount field`
                )
              )
            }
            yield* creditLedgerStore.append({
              organizationId,
              entryType: 'adjustment',
              amountDecimillicents: 0,
              reason: 'Dispute hold — credit balance frozen',
              referenceId: `stripe:dispute-created:${event.id}`,
              stripeEventId: event.id,
              metadata: {
                disputeHold: true,
                chargeAmountDecimillicents
              },
              outboxEvent: {
                eventType: 'billing.dispute_created',
                aggregateType: 'billing',
                aggregateId: organizationId,
                payload: {
                  organizationId,
                  stripeEventId: event.id,
                  chargeAmountDecimillicents
                },
                correlationId: null
              }
            }).pipe(Effect.mapError((cause) => badRequest('Failed to persist dispute hold', cause)))
          } else if (event.type === 'charge.dispute.closed') {
            // @spec INV-BILLING-009 — emit `billing.dispute_resolved` with
            // the outcome. On 'lost', also append a negative `adjustment`
            // ledger row atomically with the event.
            //
            // Fail-closed: reject unknown statuses with 4xx so Stripe retries
            // and on-call can investigate — a missing/unexpected status must
            // NOT silently map to 'won' (skipping a real deduction would be
            // irreversible customer money loss).
            const rawOutcome = readStringField(event.data.object, 'status')
              ?? readStringField(event.data.object, 'outcome')
            if (
              rawOutcome !== 'won'
              && rawOutcome !== 'lost'
              && rawOutcome !== 'warning_closed'
            ) {
              return yield* Effect.fail(
                badRequest(
                  `charge.dispute.closed ${event.id} has unrecognised status="${rawOutcome ?? 'null'}" — refusing to process for financial safety`
                )
              )
            }
            const outcome: 'won' | 'lost' = rawOutcome === 'lost' ? 'lost' : 'won'
            const parsedChargeAmountDecimillicents = readCentsAsDecimillicents(
              event.data.object,
              'amount'
            )
            if (
              outcome === 'lost'
              && (
                parsedChargeAmountDecimillicents === null
                || !isPositiveSafeInteger(parsedChargeAmountDecimillicents)
              )
            ) {
              return yield* Effect.fail(
                badRequest(
                  `charge.dispute.closed ${event.id} lost outcome is missing a usable positive amount field`
                )
              )
            }
            const chargeAmountDecimillicents = parsedChargeAmountDecimillicents ?? 0
            const adjustmentAmount = outcome === 'lost' ? -chargeAmountDecimillicents : 0
            yield* creditLedgerStore.append({
              organizationId,
              entryType: 'adjustment',
              amountDecimillicents: adjustmentAmount,
              reason: outcome === 'lost'
                ? 'Dispute lost — deducting disputed amount'
                : 'Dispute won — releasing hold',
              referenceId: `stripe:dispute-closed:${event.id}`,
              stripeEventId: event.id,
              metadata: {
                disputeResolved: true,
                outcome,
                chargeAmountDecimillicents
              },
              outboxEvent: {
                eventType: 'billing.dispute_resolved',
                aggregateType: 'billing',
                aggregateId: organizationId,
                payload: {
                  organizationId,
                  outcome,
                  // The worker's disputeResolvedWorkflow now tolerates a
                  // missing chargeAmountDecimillicents (defaults to 0 on
                  // the `won` path), but we emit it explicitly so the
                  // `lost` path doesn't silently default to 0 when the
                  // spec actually expected the disputed amount.
                  chargeAmountDecimillicents,
                  stripeEventId: event.id
                },
                correlationId: null
              }
            }).pipe(Effect.mapError((cause) => badRequest('Failed to persist dispute resolution', cause)))
          } else if (event.type === 'charge.refunded') {
            // @spec INV-BILLING-009 — Stripe-initiated refund (customer
            // portal, operator dashboard, or API). A refund event's
            // `amount_refunded` field is CUMULATIVE across every
            // refund ever applied to the charge, so computing the
            // per-event delta requires `previous_attributes.amount_refunded`.
            // For the first refund on a charge, previous is null →
            // delta is `amount_refunded - 0`.
            //
            // Append a negative `refund` ledger row in the same
            // transaction as a `billing.credits_refunded` outbox
            // event so downstream consumers (notifications, analytics)
            // see it atomically. The ledger allows the balance to go
            // negative — a customer refund for already-spent credits
            // leaves a debt, same as a dispute_lost.
            //
            // @spec INV-BILLING-CREDITS-NEVER-EXPIRE §"refund forgiveness"
            // SUBSCRIPTION REFUND FORGIVENESS: if the refunded charge
            // carries an `invoice` field, it originated from a Stripe
            // Invoice (subscription charge). Subscription charges do
            // NOT grant recurring credits — only the one-time welcome
            // credit is granted on the first successful invoice, and
            // welcome credits are refund-forgiven. Therefore a
            // subscription-invoice refund must NOT debit the ledger
            // at all (the welcome credit stays intact, the balance
            // is unchanged). Top-up and auto-recharge refunds have no
            // `invoice` field and continue through the normal debit path.
            const refundedInvoice = readStringField(event.data.object, 'invoice')
            if (refundedInvoice !== null && refundedInvoice !== '') {
              yield* Effect.logInfo(
                `charge.refunded ${event.id} has invoice=${refundedInvoice} — subscription refund, welcome credit refund-forgiven, skipping ledger debit`
              )
              return {
                processed: true as const,
                idempotent: false as const,
                eventId: event.id
              }
            }
            const cumulativeDmc =
              readCentsAsDecimillicents(event.data.object, 'amount_refunded')
            if (cumulativeDmc === null) {
              return yield* Effect.fail(
                badRequest(
                  `charge.refunded ${event.id} is missing a usable cumulative amount_refunded field`
                )
              )
            }
            const previousDmc = event.data.previousAttributes
              ? readCentsAsDecimillicents(event.data.previousAttributes, 'amount_refunded')
              : 0
            if (previousDmc === null) {
              return yield* Effect.fail(
                badRequest(
                  `charge.refunded ${event.id} has an unusable previous_attributes.amount_refunded field`
                )
              )
            }
            const refundDeltaDecimillicents = cumulativeDmc - previousDmc
            if (refundDeltaDecimillicents < 0) {
              return yield* Effect.fail(
                badRequest(
                  `charge.refunded ${event.id} has a negative refund delta ${refundDeltaDecimillicents} (cumulative=${cumulativeDmc}, previous=${previousDmc})`
                )
              )
            }
            if (refundDeltaDecimillicents === 0) {
              yield* Effect.logWarning(
                `charge.refunded ${event.id} has zero delta (cumulative=${cumulativeDmc}, previous=${previousDmc}) — ignoring`
              )
            } else {
              const stripeChargeId = readStringField(event.data.object, 'id') ?? ''
              yield* creditLedgerStore.append({
                organizationId,
                entryType: 'refund',
                amountDecimillicents: -refundDeltaDecimillicents,
                reason: 'Stripe refund',
                referenceId: `stripe:refund:${event.id}`,
                stripeEventId: event.id,
                metadata: {
                  stripeChargeId,
                  cumulativeAmountRefundedDecimillicents: cumulativeDmc,
                  previousAmountRefundedDecimillicents: previousDmc
                },
                outboxEvent: {
                  eventType: 'billing.credits_refunded',
                  aggregateType: 'billing',
                  aggregateId: organizationId,
                  payload: {
                    organizationId,
                    amountDecimillicents: refundDeltaDecimillicents,
                    stripeEventId: event.id,
                    stripeChargeId
                  },
                  correlationId: null
                }
              }).pipe(Effect.mapError((cause) => badRequest('Failed to persist refund', cause)))
            }
          }
        }

        return {
          processed: true as const,
          idempotent: false as const,
          eventId: event.id
        }
        }).pipe(Effect.onError(() => releaseClaim))
      }),

    // @spec billing-and-pricing-design
    // @spec INV-BILLING-009 — atomic ledger commit path.
    chargeAutoRecharge: (input) =>
      Effect.gen(function* () {
        // Defensive validation at the service seam: the worker passes
        // `amountDecimillicents` straight through to Stripe's
        // `createOffSessionPaymentIntent` AND to the credit ledger
        // append. A NaN/Infinity would corrupt both: Stripe rejects
        // the payload loudly but our own `attempt.amount` bigint
        // column would silently store whatever JS coerces. A negative
        // amount would create a negative PaymentIntent and a credit
        // REFUND masquerading as a recharge. Same pattern as
        // credit-service.creditsRecharged — pin at the seam before
        // any external side effect fires.
        if (
          !Number.isFinite(input.amountDecimillicents)
          || !Number.isInteger(input.amountDecimillicents)
          || !Number.isSafeInteger(input.amountDecimillicents)
          || input.amountDecimillicents <= 0
          || input.amountDecimillicents > AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS
        ) {
          return yield* Effect.fail(badRequest(
            `chargeAutoRecharge: amountDecimillicents must be a positive integer <= ${AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS.toString()}, got ${String(input.amountDecimillicents)}`
          ))
        }

        const billingStore = yield* BillingStorePort
        const stripe = yield* StripePort
        const creditService = yield* CreditServicePort
        const attemptStore = yield* AutoRechargeAttemptStorePort

        const settingsOpt = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch billing settings', cause))
        )

        if (Option.isNone(settingsOpt)) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        const settings = settingsOpt.value
        const customerId = settings.stripeCustomerId
        const paymentMethodId = settings.stripePaymentMethodId

        if (!settings.autoRechargeEnabled) {
          yield* attemptStore
            .markAttemptFailed(input.attemptId, 'auto-recharge disabled', null)
            .pipe(Effect.mapError((cause) => badRequest('Failed to mark auto-recharge attempt failed', cause)))
          return {
            status: 'failed' as const,
            stripePaymentIntentId: '',
            failureReason: 'auto-recharge disabled'
          }
        }

        if (!customerId || !paymentMethodId) {
          yield* attemptStore
            .markAttemptFailed(input.attemptId, 'no saved payment method', null)
            .pipe(Effect.mapError((cause) => badRequest('Failed to mark auto-recharge attempt failed', cause)))
          return {
            status: 'failed' as const,
            stripePaymentIntentId: '',
            failureReason: 'no saved payment method'
          }
        }

        const intent = yield* stripe
          .createOffSessionPaymentIntent({
            organizationId: input.organizationId,
            customerId,
            paymentMethodId,
            amountDecimillicents: input.amountDecimillicents,
            description: `Auto-recharge for organization ${input.organizationId}`,
            idempotencyKey: input.attemptId
          })
          .pipe(Effect.mapError((cause) => badRequest('Failed to create off-session PaymentIntent', cause)))

        if (intent.status === 'succeeded') {
          // Atomic ledger append + billing.credits_recharged outbox event
          // must happen BEFORE the attempt is marked terminal. If the
          // local credit commit fails after Stripe succeeds, leaving the
          // attempt pending lets a retry reuse the same Stripe idempotency
          // key and the same ledger referenceId. Marking succeeded first
          // could strand a paid PaymentIntent with no wallet credit.
          yield* creditService.creditsRecharged({
            organizationId: input.organizationId,
            amountDecimillicents: input.amountDecimillicents,
            stripePaymentIntentId: intent.id,
            stripeEventId: intent.id,
            referenceId: `auto-recharge:${input.attemptId}`,
            reason: 'Auto-recharge'
          })

          yield* attemptStore
            .markAttemptSucceeded(input.attemptId, intent.id)
            .pipe(Effect.mapError((cause) => badRequest('Failed to mark auto-recharge attempt succeeded', cause)))

          return {
            status: 'succeeded' as const,
            stripePaymentIntentId: intent.id,
            failureReason: null
          }
        }

        if (intent.status === 'requires_action') {
          // @spec billing-and-pricing-design §"3DS off-session challenge"
          // The PaymentIntent needs a 3DS challenge before settling. The
          // port writes the failed attempt row AND a
          // billing.recharge_requires_action outbox event in the same DB
          // transaction (INV-BILLING-009), so a downstream consumer
          // (frontend SSE / push notification) can surface the challenge
          // URL without the worker re-polling Stripe.
          //
          // If Stripe returned the intent without a client_secret (very
          // unusual — only happens when the API version pin elides it)
          // we fall back to the legacy markAttemptFailed path so the
          // attempt still terminates cleanly.
          if (intent.clientSecret) {
            yield* attemptStore
              .markAttemptRequiresActionAndEmit({
                attemptId: input.attemptId,
                organizationId: input.organizationId,
                amountDecimillicents: input.amountDecimillicents,
                stripePaymentIntentId: intent.id,
                clientSecret: intent.clientSecret
              })
              .pipe(Effect.mapError((cause) => badRequest('Failed to mark auto-recharge requires_action', cause)))
          } else {
            yield* attemptStore
              .markAttemptFailed(input.attemptId, 'requires user action', intent.id)
              .pipe(Effect.mapError((cause) => badRequest('Failed to mark auto-recharge attempt failed', cause)))
          }

          return {
            status: 'requires_action' as const,
            stripePaymentIntentId: intent.id,
            failureReason: 'requires user action'
          }
        }

        // requires_payment_method | canceled → treat as failed card decline.
        yield* attemptStore
          .markAttemptFailed(input.attemptId, 'card declined', intent.id)
          .pipe(Effect.mapError((cause) => badRequest('Failed to mark auto-recharge attempt failed', cause)))
        return {
          status: 'failed' as const,
          stripePaymentIntentId: intent.id,
          failureReason: 'card declined'
        }
      }),

    recordUsage: runRecordUsageEffect,

    recordUsageFromCostResult: (input) =>
      // Delegate to the existing recordUsage path. quantity = 1 because
      // CostResult already represents one priced operation; the
      // marginCostInCreditsDecimillicents already has the spec'd 1.10x
      // markup baked in via integer basis points (INV-BILLING-006), so
      // the ledger never re-applies the margin.
      //
      // We store the raw CostResult under metadata.cost so the breakdown
      // is preserved on the usage_records row for downstream analytics.
      // Existing metadata fields from the caller are merged on top.
      runRecordUsageEffect({
        organizationId: input.organizationId,
        category: input.category,
        quantity: 1,
        unitCostDecimillicents: input.cost.marginCostInCreditsDecimillicents,
        referenceId: input.referenceId ?? null,
        metadata: {
          ...(input.metadata ?? {}),
          cost: {
            name: input.cost.name,
            costInCreditsDecimillicents: input.cost.costInCreditsDecimillicents,
            marginCostInCreditsDecimillicents: input.cost.marginCostInCreditsDecimillicents
          }
        }
      }),

    getUsageSummary: (principal, input) =>
      Effect.gen(function* () {
        yield* assertBillingAccess(input.organizationId, principal, false)
        const billingStore = yield* BillingStorePort
        const usageStore = yield* UsageStorePort
        const guard = yield* BillingGuardPort

        const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch billing settings', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        const guardEnabled = yield* guard.isEnabled()
        if (guardEnabled && !isSubscriptionActive(settings.subscriptionStatus)) {
          return yield* Effect.fail(unauthorized('Active subscription required'))
        }

        const summary = yield* usageStore.summarizeForPeriod({
          organizationId: input.organizationId,
          category: input.category,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd
        }).pipe(Effect.mapError((cause) => badRequest('Failed to summarize usage', cause)))

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
