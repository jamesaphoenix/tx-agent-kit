/**
 * Domain event payloads for the billing subsystem.
 *
 * These events are inserted into the transactional outbox (domain_events table)
 * within the same DB transaction as the credit mutation that triggers them.
 * Downstream consumers (Temporal workflows) process them asynchronously.
 *
 * The reserve/finalize/release lifecycle does NOT emit outbox events — those
 * are synchronous internal accounting. Only threshold crossings and state
 * changes flow through the outbox.
 */

/** Stripe payment added credits to the org balance. */
export interface BillingCreditsPurchasedEventPayload {
  readonly organizationId: string
  readonly amountDecimillicents: number
  readonly stripeEventId: string
}

/** Auto-recharge succeeded — credits topped up automatically. */
export interface BillingCreditsRechargedEventPayload {
  readonly organizationId: string
  readonly amountDecimillicents: number
  readonly stripePaymentIntentId: string
}

/** Balance dropped below the auto-recharge threshold. */
export interface BillingCreditsLowBalanceEventPayload {
  readonly organizationId: string
  readonly currentBalanceDecimillicents: number
  readonly thresholdDecimillicents: number
}

/** Org has used 80% or 95% of their monthly usage cap. */
export interface BillingUsageCapWarningEventPayload {
  readonly organizationId: string
  readonly percentUsed: number
  readonly capDecimillicents: number
}

/** Org has hit 100% of their monthly usage cap. */
export interface BillingUsageCapExceededEventPayload {
  readonly organizationId: string
  readonly capDecimillicents: number
}

/** Stripe invoice.payment_failed — org enters 7-day grace period. */
export interface BillingPaymentFailedEventPayload {
  readonly organizationId: string
  readonly stripeEventId: string
  readonly gracePeriodEndsAt: string
}

/** Chargeback filed — org balance should be frozen. */
export interface BillingDisputeCreatedEventPayload {
  readonly organizationId: string
  readonly stripeEventId: string
  readonly chargeAmountDecimillicents: number
}

/** Chargeback resolved — unfreeze (won) or permanently deduct (lost). */
export interface BillingDisputeResolvedEventPayload {
  readonly organizationId: string
  readonly outcome: 'won' | 'lost'
}

/**
 * Stripe-initiated refund — a top-up charge was refunded in whole or
 * in part (customer portal refund, operator-initiated refund from the
 * Stripe dashboard, or programmatic refund via the API). The ledger
 * deducts the refunded decimillicents as a negative `refund` row in
 * the same transaction as this outbox event.
 *
 * Refunds can drive the balance below zero if the customer has
 * already spent the refunded credits — that's expected, same as a
 * dispute_lost outcome. The suspension policy is a separate downstream
 * decision.
 */
export interface BillingCreditsRefundedEventPayload {
  readonly organizationId: string
  readonly amountDecimillicents: number
  readonly stripeEventId: string
  readonly stripeChargeId: string
}

/** Customer cancelled their subscription. */
export interface BillingSubscriptionCancelledEventPayload {
  readonly organizationId: string
}

/**
 * One-time welcome credit granted on the first successful subscription
 * charge. Emitted in the same DB transaction as the credit_ledger
 * `adjustment` row with `reason='welcome_credit'` and the
 * `organizations.welcome_credit_granted_at` timestamp update.
 *
 * @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
 */
export interface BillingWelcomeCreditGrantedEventPayload {
  readonly organizationId: string
  readonly amountDecimillicents: number
  readonly plan: 'try_me' | 'pro' | 'agency'
  readonly stripeEventId: string
}

/**
 * Auto-recharge off-session PaymentIntent returned `requires_action` —
 * the org owner must complete a 3DS challenge before the charge can
 * settle. The frontend listens for this event and surfaces a challenge
 * link via the Stripe Elements `confirmCardPayment` API using the
 * `clientSecret` carried in the payload.
 *
 * @spec billing-and-pricing-design §"3DS off-session challenge"
 */
export interface BillingRechargeRequiresActionEventPayload {
  readonly organizationId: string
  readonly attemptId: string
  readonly amountDecimillicents: number
  readonly stripePaymentIntentId: string
  /**
   * Stripe PaymentIntent client_secret. The frontend uses this with
   * `stripe.confirmCardPayment(clientSecret)` to complete the 3DS
   * challenge. Treated as a short-lived secret — the API layer SHOULD
   * NOT log it and the consumer should drop the value once the user
   * has been redirected.
   */
  readonly clientSecret: string
}
