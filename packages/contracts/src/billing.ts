import * as Schema from 'effect/Schema'
import {
  autoRechargeStatuses,
  creditEntryTypes,
  subscriptionPlanSlugs,
  subscriptionStatuses,
  usageCategories,
  type SubscriptionPlanSlug
} from './literals.js'

export const DECIMILLICENTS_PER_CENT = 100_000
export const DECIMILLICENTS_PER_DOLLAR = 10_000_000
export const LOCAL_DEV_SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000

export const toDecimillicents = (dollars: number): number =>
  Math.round(dollars * DECIMILLICENTS_PER_DOLLAR)

export const fromDecimillicents = (decimillicents: number): number =>
  decimillicents / DECIMILLICENTS_PER_DOLLAR

export const usageCategorySchema = Schema.Literal(...usageCategories)
export const creditEntryTypeSchema = Schema.Literal(...creditEntryTypes)
export const billingSubscriptionPlanSlugSchema = Schema.Literal(...subscriptionPlanSlugs)
export const billingSubscriptionStatusSchema = Schema.Literal(...subscriptionStatuses)
export const autoRechargeStatusSchema = Schema.Literal(...autoRechargeStatuses)

// @spec INV-BILLING-006
// CostResult captures a single priced operation. Multi-step workflows
// (e.g. text-gen + image-gen + embedding) produce a CostResult[] which
// aggregates trivially while preserving per-operation attribution.
// Shape follows the legacy tx-agent-kit-services reference at
// tx-agent-kit-services/packages/platform/supabase/src/dtos/credits/cost-result.ts.
export const costResultSchema = Schema.Struct({
  /** Operation attribution — format: `service.operation.model`
   *  (e.g. `ai.text_generation.gpt-5`, `ai.image_generation.gpt-image-1`). */
  name: Schema.String.pipe(Schema.minLength(1)),
  /** Base (pre-margin) cost in decimillicents. 1 credit = 1 decimillicent. */
  costInCreditsDecimillicents: Schema.Number,
  /** Base cost in dollars (derived, for display). */
  costInDollars: Schema.Number,
  /** Customer-facing cost in decimillicents — base × marginMultiplier. */
  marginCostInCreditsDecimillicents: Schema.Number,
  /** Customer-facing cost in dollars (derived, for display). */
  marginCostInDollars: Schema.Number
})

export const costResultArraySchema = Schema.Array(costResultSchema)

export type CostResult = Schema.Schema.Type<typeof costResultSchema>

/** Default margin multiplier — 10% infrastructure markup (spec INV-BILLING-006).
 *  Read from `system_settings.profit_margin` at runtime; this is the fallback. */
export const DEFAULT_MARGIN_MULTIPLIER = 1.10

/** Construct a priced CostResult. Margin is applied at creation time —
 *  never at ledger time — so the ledger stores the pre-calculated margin
 *  cost and never needs to recompute it.
 *
 *  Margin is applied via integer basis points (4-decimal precision) to
 *  match the `usage_records.margin_multiplier` column convention (BIGINT
 *  basis points: 1100 = 1.10x) and eliminate IEEE-754 float artifacts.
 *
 *  @param name        Operation attribution (`service.operation.model`)
 *  @param costInCreditsDecimillicents  Base cost (pre-margin), integer decimillicents
 *  @param marginMultiplier Defaults to DEFAULT_MARGIN_MULTIPLIER (1.10)
 */
export const createCostResult = (
  name: string,
  costInCreditsDecimillicents: number,
  marginMultiplier: number = DEFAULT_MARGIN_MULTIPLIER
): CostResult => {
  // Hard-fail on inputs that would silently corrupt the ledger. This is
  // the contract seam — callers must arrive with clean integer cents,
  // and a margin multiplier that is at least 1.0 (no discount ever
  // reaches the customer through this helper). Letting bad inputs
  // through here produces free-to-customer operations or NaN ledger
  // rows, both of which are far worse than a loud error.
  if (
    !Number.isFinite(costInCreditsDecimillicents)
    || !Number.isInteger(costInCreditsDecimillicents)
    || costInCreditsDecimillicents < 0
  ) {
    throw new Error(
      `createCostResult: costInCreditsDecimillicents must be a non-negative integer, got ${String(costInCreditsDecimillicents)}`
    )
  }
  if (
    !Number.isFinite(marginMultiplier)
    || marginMultiplier < 1
  ) {
    throw new Error(
      `createCostResult: marginMultiplier must be a finite number >= 1, got ${String(marginMultiplier)}`
    )
  }

  const marginBasisPoints = Math.round(marginMultiplier * 10_000) // 1.10 → 11000
  const marginCostInCreditsDecimillicents = Math.ceil(
    (costInCreditsDecimillicents * marginBasisPoints) / 10_000
  )
  return {
    name,
    costInCreditsDecimillicents,
    costInDollars: fromDecimillicents(costInCreditsDecimillicents),
    marginCostInCreditsDecimillicents,
    marginCostInDollars: fromDecimillicents(marginCostInCreditsDecimillicents)
  }
}

export interface AggregatedCostResult {
  readonly totalCostInCreditsDecimillicents: number
  readonly totalCostInDollars: number
  readonly totalMarginCostInCreditsDecimillicents: number
  readonly totalMarginCostInDollars: number
  /** Breakdown is preserved so downstream ledger writers can append one
   *  row per priced operation with full attribution. */
  readonly breakdown: ReadonlyArray<CostResult>
}

/** Sum an array of CostResults while preserving the per-operation breakdown.
 *  Totals are rounded at the aggregated level only. */
export const aggregateCosts = (
  costs: ReadonlyArray<CostResult>
): AggregatedCostResult => {
  let totalCost = 0
  let totalMargin = 0
  for (const cost of costs) {
    totalCost += cost.costInCreditsDecimillicents
    totalMargin += cost.marginCostInCreditsDecimillicents
  }
  return {
    totalCostInCreditsDecimillicents: totalCost,
    totalCostInDollars: fromDecimillicents(totalCost),
    totalMarginCostInCreditsDecimillicents: totalMargin,
    totalMarginCostInDollars: fromDecimillicents(totalMargin),
    breakdown: costs
  }
}

/** Group CostResults by service prefix (the first segment of `name`).
 *  `ai.text_generation.gpt-5` → `ai`. */
export const groupCostsByService = (
  costs: ReadonlyArray<CostResult>
): Record<string, ReadonlyArray<CostResult>> => {
  const grouped: Record<string, CostResult[]> = {}
  for (const cost of costs) {
    const [service] = cost.name.split('.')
    const key = service !== undefined && service.length > 0 ? service : 'unknown'
    const bucket = grouped[key] ?? (grouped[key] = [])
    bucket.push(cost)
  }
  return grouped
}

/** Validate that every CostResult has a non-empty `name` — attribution is
 *  required for downstream analytics and ledger breakdowns. Throws on the
 *  first offender so callers fail fast at construction time. */
export const validateCostNames = (costs: ReadonlyArray<CostResult>): void => {
  for (const cost of costs) {
    if (!cost.name || cost.name.trim().length === 0) {
      throw new Error('CostResult.name is required for attribution')
    }
  }
}

/** Minimal duck-typed OpenRouter response shape — callers pass the
 *  already-completed response object; this contract file stays free of
 *  any `@openrouter/sdk` or `@tx-agent-kit/ai` dependency so billing
 *  helpers can live alongside the rest of the contracts. */
export interface OpenRouterUsageLike {
  readonly model: string
  readonly usage?: { readonly cost?: number | null } | null
}

/** Turn an OpenRouter response into a CostResult. The raw dollar cost comes
 *  directly from OpenRouter's usage block (spec: "For OpenRouter-routed
 *  operations, cost is taken directly from OpenRouter's response and mapped
 *  into CostResult"). Margin is applied via {@link createCostResult}.
 *
 *  @param response  OpenRouter completion response (duck-typed).
 *  @param operation Operation tag — e.g. `text_generation` / `image_generation`
 *                   / `embedding`. Defaults to `text_generation`.
 *  @param marginMultiplier Defaults to DEFAULT_MARGIN_MULTIPLIER (1.10).
 */
export const createCostResultFromOpenRouterUsage = (
  response: OpenRouterUsageLike,
  operation: string = 'text_generation',
  marginMultiplier: number = DEFAULT_MARGIN_MULTIPLIER
): CostResult => {
  const costInDollars = response.usage?.cost ?? 0
  const costInCreditsDecimillicents = Math.round(costInDollars * DECIMILLICENTS_PER_DOLLAR)
  const name = `ai.${operation}.${response.model}`
  return createCostResult(name, costInCreditsDecimillicents, marginMultiplier)
}

export const creditBalanceResponseSchema = Schema.Struct({
  creditsBalanceDecimillicents: Schema.Number,
  reservedCreditsDecimillicents: Schema.Number,
  availableDecimillicents: Schema.Number,
  /**
   * Whether the org is currently blocked from new credit-consuming
   * operations. TRUE when either `organizations.suspended_at` is set
   * (usage cap exceeded, open dispute) OR
   * `organizations.payment_grace_period_ends_at` is set (unresolved
   * failed payment). The billing repository's reservation guard
   * rejects new reserves when either flag is in effect, so the UI
   * should treat either as "operations blocked".
   *
   * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
   * @spec billing-and-pricing-design §"Failed Payment Lifecycle"
   */
  isSuspended: Schema.Boolean,
  /**
   * ISO-8601 timestamp of when the org was suspended, or `null` when
   * the org is healthy. Surfaced separately from `isSuspended` so
   * the UI can render "suspended 2 hours ago" without having to
   * synthesize a timestamp.
   */
  suspendedAt: Schema.NullOr(Schema.String),
  /**
   * ISO-8601 timestamp of the current payment grace period end, or
   * `null` when there is no unresolved payment failure. The column
   * is set by the billing worker on `invoice.payment_failed` and
   * cleared by the webhook handler on `invoice.payment_succeeded`.
   * UI consumers should render "payment required — update your card
   * method by <date>" when this is non-null, even though the clock
   * value is only an indicator — wall-clock expiry does NOT unblock
   * the org; only an `invoice.payment_succeeded` clears it.
   *
   * @spec billing-and-pricing-design §"Failed Payment Lifecycle"
   */
  paymentGracePeriodEndsAt: Schema.NullOr(Schema.String)
})

export type CreditBalanceResponse = Schema.Schema.Type<typeof creditBalanceResponseSchema>

export const billingSettingsSchema = Schema.Struct({
  organizationId: Schema.UUID,
  billingEmail: Schema.NullOr(Schema.String),
  stripeCustomerId: Schema.NullOr(Schema.String),
  stripeSubscriptionId: Schema.NullOr(Schema.String),
  stripePaymentMethodId: Schema.NullOr(Schema.String),
  stripeMeteredSubscriptionItemId: Schema.NullOr(Schema.String),
  creditsBalanceDecimillicents: Schema.Number,
  reservedCreditsDecimillicents: Schema.Number,
  autoRechargeEnabled: Schema.Boolean,
  autoRechargeThresholdDecimillicents: Schema.NullOr(Schema.Number),
  autoRechargeAmountDecimillicents: Schema.NullOr(Schema.Number),
  usageCapDecimillicents: Schema.NullOr(Schema.Number),
  isSubscribed: Schema.Boolean,
  subscriptionStatus: billingSubscriptionStatusSchema,
  subscriptionPlan: Schema.NullOr(billingSubscriptionPlanSlugSchema),
  subscriptionStartedAt: Schema.NullOr(Schema.String),
  subscriptionEndsAt: Schema.NullOr(Schema.String),
  subscriptionCurrentPeriodEnd: Schema.NullOr(Schema.String),
  /** ISO-8601 timestamp when the org was suspended via
   *  `organizations.suspended_at` (usage cap exceeded / open dispute),
   *  or `null` when healthy. Surfaced here so the settings page can
   *  render the same "operations blocked" banner as `GET /credits`. */
  suspendedAt: Schema.NullOr(Schema.String),
  /** ISO-8601 timestamp when an unresolved payment failure started the
   *  grace period via `organizations.payment_grace_period_ends_at`, or
   *  `null` when there is no outstanding failure. Cleared by
   *  `invoice.payment_succeeded`, NOT by wall-clock expiry. */
  paymentGracePeriodEndsAt: Schema.NullOr(Schema.String)
})

export const usageRecordSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  category: usageCategorySchema,
  quantity: Schema.Number,
  unitCostDecimillicents: Schema.Number,
  totalCostDecimillicents: Schema.Number,
  referenceId: Schema.NullOr(Schema.String),
  stripeUsageRecordId: Schema.NullOr(Schema.String),
  metadata: Schema.Unknown,
  recordedAt: Schema.String,
  createdAt: Schema.String
})

export const usageSummarySchema = Schema.Struct({
  organizationId: Schema.UUID,
  category: usageCategorySchema,
  periodStart: Schema.String,
  periodEnd: Schema.String,
  totalQuantity: Schema.Number,
  totalCostDecimillicents: Schema.Number
})

export const noCapReminderPreferenceSchema = Schema.Struct({
  dismissed: Schema.Boolean
})

export const autoRechargeRequiresActionChallengeSchema = Schema.NullOr(
  Schema.Struct({
    attemptId: Schema.UUID,
    amountDecimillicents: Schema.Number,
    stripePaymentIntentId: Schema.String,
    clientSecret: Schema.String
  })
)

export const createCheckoutSessionSchema = Schema.Struct({
  organizationId: Schema.UUID,
  subscriptionPlan: billingSubscriptionPlanSlugSchema,
  successUrl: Schema.String.pipe(Schema.pattern(/^https?:\/\//)),
  cancelUrl: Schema.String.pipe(Schema.pattern(/^https?:\/\//))
})

export const createPortalSessionSchema = Schema.Struct({
  organizationId: Schema.UUID,
  returnUrl: Schema.String.pipe(Schema.pattern(/^https?:\/\//))
})

export const completeLocalBillingSetupSchema = Schema.Struct({
  subscriptionPlan: billingSubscriptionPlanSlugSchema
})

/** POST /v1/billing/:orgId/top-up — one-time Stripe Checkout session in
 *  `payment` mode.
 *
 *  Bounds (decimillicents: 10_000_000 = $1 → 100_000 = $0.01 = 1 cent):
 *    - MIN: 100_000 (1 cent, matches Stripe's minimum charge unit)
 *    - MAX: 5_000_000_000 = $500 × 10_000_000 decimillicents per dollar.
 *      Caps a single top-up at $500 — realistic for our current pricing
 *      (a full month of heavy AI usage is well under this) and tight
 *      enough that a fat-fingered 10× or 100× mistake is obvious to the
 *      user before they confirm on the Stripe-hosted checkout page.
 *      Customers that need more can issue multiple top-ups.
 *
 *  @spec billing-and-pricing-design §"Top-up bounds"
 */
export const TOP_UP_MIN_DECIMILLICENTS = 100_000
export const TOP_UP_MAX_DECIMILLICENTS = 5_000_000_000

/**
 * Welcome credit granted one-time per organization on the first
 * successful `invoice.payment_succeeded` Stripe webhook.
 *
 *  - Try Me  → $9
 *  - Pro     → $20
 *  - Agency  → $45
 *
 * Welcome credits never expire and are refund-forgiven (the charge.refunded
 * handler skips debits for subscription-invoice refunds, leaving the
 * welcome credit ledger row untouched).
 *
 * @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
 * @spec INV-BILLING-CREDITS-NEVER-EXPIRE
 * @spec billing-and-pricing-design §"Welcome Credits"
 */
export const WELCOME_CREDIT_DECIMILLICENTS = {
  try_me: 90_000_000, // $9 = 9 × 10_000_000 decimillicents-per-dollar
  pro: 200_000_000,   // $20
  agency: 450_000_000 // $45
} as const satisfies Record<SubscriptionPlanSlug, number>

export const createTopUpSessionSchema = Schema.Struct({
  amountDecimillicents: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(TOP_UP_MIN_DECIMILLICENTS),
    Schema.lessThanOrEqualTo(TOP_UP_MAX_DECIMILLICENTS)
  ),
  successUrl: Schema.String.pipe(Schema.pattern(/^https?:\/\//)),
  cancelUrl: Schema.String.pipe(Schema.pattern(/^https?:\/\//))
})

export type CreateTopUpSessionInput = Schema.Schema.Type<typeof createTopUpSessionSchema>
/** Auto-recharge bounds — apply the same integer + min/max rails as
 *  one-time top-ups so the user can't stash a negative threshold
 *  (auto-recharge fires on every debit), a fractional amount (weird
 *  rounding + bigint ledger), or a value larger than the Stripe cap
 *  (charge rejected at Stripe time, silent retry loop).
 *
 *  Threshold floor pinned at 1 decimillicent (NOT 0). The ledger
 *  repo's `finalizeReservation` only emits the atomic
 *  `billing.credits_low_balance` outbox event when
 *  `lowBalanceThreshold > 0` (see credit-ledger.ts:424) — a
 *  threshold of 0 would silently disable auto-recharge for the
 *  account forever, and no downstream signal would ever reach the
 *  Temporal trigger. A non-zero minimum closes that trap at the
 *  schema seam so the two layers can never disagree. */
export const AUTO_RECHARGE_THRESHOLD_MIN_DECIMILLICENTS = 1
export const AUTO_RECHARGE_THRESHOLD_MAX_DECIMILLICENTS = TOP_UP_MAX_DECIMILLICENTS
export const AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS = TOP_UP_MIN_DECIMILLICENTS
export const AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS = TOP_UP_MAX_DECIMILLICENTS

const autoRechargeThresholdField = Schema.optional(
  Schema.NullOr(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(AUTO_RECHARGE_THRESHOLD_MIN_DECIMILLICENTS),
      Schema.lessThanOrEqualTo(AUTO_RECHARGE_THRESHOLD_MAX_DECIMILLICENTS)
    )
  )
)

const autoRechargeAmountField = Schema.optional(
  Schema.NullOr(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS),
      Schema.lessThanOrEqualTo(AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS)
    )
  )
)

const usageCapField = Schema.optional(
  Schema.NullOr(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(0)
    )
  )
)

export const updateBillingSettingsSchema = Schema.Struct({
  billingEmail: Schema.optional(Schema.NullOr(Schema.String)),
  autoRechargeEnabled: Schema.optional(Schema.Boolean),
  autoRechargeThresholdDecimillicents: autoRechargeThresholdField,
  autoRechargeAmountDecimillicents: autoRechargeAmountField,
  usageCapDecimillicents: usageCapField
})

export const recordUsageInputSchema = Schema.Struct({
  organizationId: Schema.UUID,
  category: usageCategorySchema,
  // Quantity is strictly positive (>= 1) — the service layer rejects
  // quantity < 1 as an invalid usage payload, so a caller passing 0
  // would get a 400 anyway. Pinning it here fails loudly at the
  // schema seam and keeps the two layers consistent.
  //
  // Unit cost can be 0 (free operation — we still want the audit
  // row so downstream analytics see the call) but not negative,
  // NaN, or fractional — the service multiplies it into
  // totalCostDecimillicents which lands on the bigint audit column.
  quantity: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  unitCostDecimillicents: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(0)
  ),
  referenceId: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(Schema.Unknown)
})

export const usageSummaryQuerySchema = Schema.Struct({
  organizationId: Schema.UUID,
  category: usageCategorySchema,
  periodStart: Schema.String,
  periodEnd: Schema.String
})

export const sessionUrlResponseSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.String
})

export const stripeWebhookResponseSchema = Schema.Struct({
  processed: Schema.Boolean,
  idempotent: Schema.Boolean,
  eventId: Schema.String
})

export const usageQueryParamsSchema = Schema.Struct({
  category: Schema.Literal(...usageCategories),
  periodStart: Schema.optional(Schema.String),
  periodEnd: Schema.optional(Schema.String)
})

export type BillingSettings = Schema.Schema.Type<typeof billingSettingsSchema>
export type UsageRecord = Schema.Schema.Type<typeof usageRecordSchema>
export type UsageSummary = Schema.Schema.Type<typeof usageSummarySchema>
export type NoCapReminderPreference = Schema.Schema.Type<typeof noCapReminderPreferenceSchema>
export type AutoRechargeRequiresActionChallenge = Schema.Schema.Type<
  typeof autoRechargeRequiresActionChallengeSchema
>
export type CreateCheckoutSessionInput = Schema.Schema.Type<typeof createCheckoutSessionSchema>
export type CreatePortalSessionInput = Schema.Schema.Type<typeof createPortalSessionSchema>
export type CompleteLocalBillingSetupInput = Schema.Schema.Type<typeof completeLocalBillingSetupSchema>
export type UpdateBillingSettingsInput = Schema.Schema.Type<typeof updateBillingSettingsSchema>
export type RecordUsageInput = Schema.Schema.Type<typeof recordUsageInputSchema>
export type UsageSummaryQuery = Schema.Schema.Type<typeof usageSummaryQuerySchema>
export type SessionUrlResponse = Schema.Schema.Type<typeof sessionUrlResponseSchema>
export type StripeWebhookResponse = Schema.Schema.Type<typeof stripeWebhookResponseSchema>
export type UsageQueryParams = Schema.Schema.Type<typeof usageQueryParamsSchema>
