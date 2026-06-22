import { randomUUID } from 'node:crypto'
import { StripePort, type StripeWebhookEvent } from '@tx-agent-kit/core'
import type { SubscriptionPlanSlug } from '@tx-agent-kit/contracts'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect, Layer } from 'effect'
import Stripe from 'stripe'
import type { StripeCheckoutPriceIds, StripePortConfig } from './config.js'
import { toJsonObject } from './json.js'
import { readFailedPaymentIntentDetails } from './payment-intent-error.js'

/**
 * Shared Stripe SDK API version pin used by both the API and worker
 * adapters. Kept here so upgrades happen in exactly one place.
 */
export const STRIPE_API_VERSION = '2025-10-29.clover' as const

const stripeLogger = createLogger('tx-agent-kit-stripe')

const resolveCheckoutPriceIds = (
  config: StripePortConfig,
  subscriptionPlan: SubscriptionPlanSlug
): { recurring: string } | null => {
  const planConfig = config.checkoutPriceIds[subscriptionPlan]
  if (!planConfig.recurring) {
    return null
  }
  return {
    recurring: planConfig.recurring
  }
}

/**
 * Parse a webhook event body WITHOUT signature verification — only used as
 * a dev/test fallback when the Stripe client or webhook secret is not
 * configured. Production always goes through `stripe.webhooks.constructEvent`.
 */
const parseWebhookEventWithoutVerification = (rawBody: string): StripeWebhookEvent => {
  const parsed = JSON.parse(rawBody) as unknown
  const payload = toJsonObject(parsed)
  const eventId = typeof payload.id === 'string' ? payload.id : 'local-webhook-event'
  const eventType = typeof payload.type === 'string' ? payload.type : 'unknown'
  const data = toJsonObject(payload.data)
  const previousAttributes = data.previous_attributes !== undefined && data.previous_attributes !== null
    ? toJsonObject(data.previous_attributes)
    : null

  return {
    id: eventId,
    type: eventType,
    payload,
    data: {
      object: toJsonObject(data.object),
      previousAttributes
    }
  }
}

/**
 * Map a Stripe PaymentIntent status into the narrow return type of
 * `StripePort.createOffSessionPaymentIntent`. Any unexpected status is
 * coerced to `requires_payment_method` so the caller treats it as a
 * retryable card failure.
 */
const mapOffSessionIntentStatus = (status: string) => {
  if (status === 'succeeded') {
    return 'succeeded' as const
  }
  if (status === 'requires_action') {
    return 'requires_action' as const
  }
  if (status === 'canceled') {
    return 'canceled' as const
  }
  return 'requires_payment_method' as const
}

/**
 * Construct a `StripePort` live adapter Layer from an explicit config.
 *
 * The factory owns a single cached `Stripe` client instance per invocation
 * so repeated port method calls don't reconstruct the SDK. Methods that
 * need a configured Stripe client fall back to deterministic local stubs
 * when `config.secretKey` is absent, making integration tests cheap:
 *
 *   - `createCheckoutSession` → `cs_local_<uuid>`
 *   - `createPortalSession` → `bps_local_<uuid>`
 *   - `createTopUpSession` → `cs_topup_local_<uuid>`
 *   - `createCustomer` → `cus_local_<organizationId>`
 *   - `constructWebhookEvent` → parse without signature verification (dev/test only)
 *   - `createOffSessionPaymentIntent` → `pi_local_<uuid>` reporting `succeeded`
 * Methods that need additional config (e.g. `createCheckoutSession` needs
 * a recurring price id for the selected plan) `Effect.fail` with a descriptive
 * error when that config is missing AND the method is actually called —
 * never `Effect.die`, so a misconfigured route surfaces as a 4xx/5xx
 * rather than crashing the process.
 *
 * @spec billing-and-pricing-design
 */
export const makeStripePortLive = (
  config: StripePortConfig
): Layer.Layer<StripePort> => {
  const stripeClient: Stripe | null = config.secretKey
    ? new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION })
    : null

  const isDevOrTest = config.nodeEnv === 'development' || config.nodeEnv === 'test'

  // Build a lookup table from configured recurring Stripe Price IDs onto our
  // internal plan slug. Credits and auto-recharge are accounted for in the
  // local ledger, not Stripe metered subscription items.
  // @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
  const priceIdToSlug = new Map<string, SubscriptionPlanSlug>()
  for (const [slug, ids] of Object.entries(config.checkoutPriceIds) as Array<[
    SubscriptionPlanSlug,
    StripeCheckoutPriceIds
  ]>) {
    if (ids.recurring) {
      priceIdToSlug.set(ids.recurring, slug)
    }
  }

  return Layer.succeed(StripePort, {
    createCheckoutSession: (input) =>
      Effect.gen(function* () {
        if (!stripeClient) {
          return {
            id: `cs_local_${randomUUID()}`,
            url: `${input.successUrl}?session_id=cs_local`
          }
        }

        const checkoutPriceIds = resolveCheckoutPriceIds(config, input.subscriptionPlan)
        if (!checkoutPriceIds) {
          return yield* Effect.fail(
            new Error(
              `Stripe recurring price ID is not configured for plan "${input.subscriptionPlan}"`
            )
          )
        }

        // Pre-generate the Stripe idempotency key OUTSIDE `Effect.tryPromise`
        // so Effect-level retries (e.g. Effect.retry) coalesce on the same
        // key. Stripe dedupes matching keys for 24h, closing the
        // "response-lost-on-network-hiccup → duplicate subscription" gap.
        // A fresh Effect.gen invocation (new HTTP request from client)
        // still gets a new key — which is correct: we WANT a distinct
        // session when the user explicitly re-submits.
        const idempotencyKey = `checkout:sub:${input.organizationId}:${randomUUID()}`

        return yield* Effect.tryPromise({
          try: async () => {
            const session = await stripeClient.checkout.sessions.create(
              {
                mode: 'subscription',
                customer: input.customerId,
                success_url: input.successUrl,
                cancel_url: input.cancelUrl,
                client_reference_id: input.organizationId,
                metadata: {
                  organizationId: input.organizationId,
                  subscriptionPlan: input.subscriptionPlan
                },
                subscription_data: {
                  metadata: {
                    organizationId: input.organizationId,
                    subscriptionPlan: input.subscriptionPlan
                  }
                },
                line_items: [
                  { price: checkoutPriceIds.recurring, quantity: 1 }
                ]
              },
              { idempotencyKey }
            )

            if (!session.url) {
              throw new Error('Stripe checkout session did not include a redirect URL.')
            }

            return { id: session.id, url: session.url }
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error)))
        })
      }),

    createPortalSession: (input) =>
      Effect.gen(function* () {
        if (!stripeClient) {
          return { id: `bps_local_${randomUUID()}`, url: input.returnUrl }
        }

        const idempotencyKey = `portal:${input.customerId}:${randomUUID()}`

        return yield* Effect.tryPromise({
          try: async () => {
            const session = await stripeClient.billingPortal.sessions.create(
              {
                customer: input.customerId,
                return_url: input.returnUrl
              },
              { idempotencyKey }
            )
            return { id: session.id, url: session.url }
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error)))
        })
      }),

    createTopUpSession: (input) =>
      Effect.gen(function* () {
        if (!stripeClient) {
          return {
            id: `cs_topup_local_${randomUUID()}`,
            url: `${input.successUrl}?session_id=cs_topup_local`
          }
        }

        const idempotencyKey = `checkout:topup:${input.organizationId}:${randomUUID()}`

        return yield* Effect.tryPromise({
          try: async () => {
            // amountDecimillicents → cents → integer. 1 decimillicent is
            // $0.00001; 100_000 decimillicents make a cent. Stripe expects
            // `unit_amount` in the smallest currency unit (positive integer).
            const unitAmountCents = Math.floor(input.amountDecimillicents / 100_000)
            if (unitAmountCents < 1) {
              throw new Error('Top-up amount must be at least 1 cent')
            }

            const session = await stripeClient.checkout.sessions.create(
              {
              mode: 'payment',
              customer: input.customerId,
              success_url: input.successUrl,
              cancel_url: input.cancelUrl,
              client_reference_id: input.organizationId,
              metadata: {
                organizationId: input.organizationId,
                topUpAmountDecimillicents: String(input.amountDecimillicents)
              },
              // Propagate the organizationId down to the spawned
              // PaymentIntent too. The checkout-session-level metadata
              // above is only visible on checkout.session.* events; any
              // future handler that listens to payment_intent.succeeded
              // / charge.refunded / payment_intent.payment_failed needs
              // the org pointer on the intent itself to resolve back
              // to our org row — otherwise those events can't be
              // mapped without a customer-id lookup, which fails for
              // never-subscribed orgs whose customer was created
              // lazily by this same flow.
              payment_intent_data: {
                metadata: {
                  organizationId: input.organizationId,
                  topUpAmountDecimillicents: String(input.amountDecimillicents)
                }
              },
              line_items: [
                {
                  quantity: 1,
                  price_data: {
                    currency: 'usd',
                    unit_amount: unitAmountCents,
                    product_data: {
                      name: 'tx-agent-kit credit top-up',
                      description: `Add credits to organization ${input.organizationId}`
                    }
                  }
                }
              ]
              },
              { idempotencyKey }
            )

            if (!session.url) {
              throw new Error('Stripe top-up session did not include a redirect URL.')
            }

            return { id: session.id, url: session.url }
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error)))
        })
      }),

    constructWebhookEvent: (rawBody: string, signature: string) =>
      Effect.gen(function* () {
        const webhookSecret = config.webhookSecret

        if (!stripeClient || !webhookSecret) {
          if (isDevOrTest) {
            stripeLogger.warn(
              'Processing webhook without signature verification (Stripe not fully configured)'
            )
            return parseWebhookEventWithoutVerification(rawBody)
          }
          return yield* Effect.fail(
            new Error(
              'Stripe webhook secret is not configured — signature verification required outside development'
            )
          )
        }

        return yield* Effect.try({
          try: () => {
            const event = stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret)
            const payload = toJsonObject(event)
            const eventData = (event.data as { object: unknown; previous_attributes?: unknown }).object
            const rawPrevious = (event.data as { previous_attributes?: unknown }).previous_attributes
            const previousAttributes = rawPrevious !== undefined && rawPrevious !== null
              ? toJsonObject(rawPrevious)
              : null
            return {
              id: event.id,
              type: event.type,
              payload,
              data: { object: toJsonObject(eventData), previousAttributes }
            } satisfies StripeWebhookEvent
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error)))
        })
      }),

    createCustomer: (input) =>
      Effect.gen(function* () {
        if (!stripeClient) {
          return { id: `cus_local_${input.organizationId}` }
        }

        return yield* Effect.tryPromise({
          try: async () => {
            // Idempotency key keyed by orgId collapses two parallel
            // createCustomer calls for the same org into a single
            // Stripe customer. Without this, a racing createCheckoutSession
            // + createTopUpSession (or two parallel tabs hitting the
            // same endpoint) each call stripeClient.customers.create
            // and get DIFFERENT ids; the loser of the
            // claimStripeCustomerId DB update then has an orphaned
            // Stripe customer object floating around with no org
            // pointer. Stripe's idempotency cache (24h) returns the
            // first call's response on the second, so both requesters
            // end up with the same customer id.
            const customer = await stripeClient.customers.create(
              {
                email: input.email,
                metadata: { organizationId: input.organizationId }
              },
              { idempotencyKey: `org-customer:${input.organizationId}` }
            )
            return { id: customer.id }
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error)))
        })
      }),

    createOffSessionPaymentIntent: (input) =>
      Effect.gen(function* () {
        if (!stripeClient) {
          // Dev/test stub: pretend the payment succeeded and return a
          // synthetic PaymentIntent id. Integration tests exercise this
          // path against the full billing consumer graph.
          const unitAmountCentsStub = Math.floor(input.amountDecimillicents / 100_000)
          return {
            id: `pi_local_${randomUUID()}`,
            status: 'succeeded' as const,
            amountCharged: unitAmountCentsStub,
            clientSecret: null
          }
        }

        const unitAmountCents = Math.floor(input.amountDecimillicents / 100_000)
        if (unitAmountCents < 1) {
          return yield* Effect.fail(new Error('Auto-recharge amount must be at least 1 cent'))
        }

        return yield* Effect.tryPromise({
          try: async () => {
            try {
              const intent = await stripeClient.paymentIntents.create(
                {
                  amount: unitAmountCents,
                  currency: 'usd',
                  customer: input.customerId,
                  payment_method: input.paymentMethodId,
                  off_session: true,
                  confirm: true,
                  description: input.description,
                  metadata: {
                    organizationId: input.organizationId,
                    autoRechargeAttemptId: input.idempotencyKey
                  }
                },
                { idempotencyKey: input.idempotencyKey }
              )

              const mapped = mapOffSessionIntentStatus(intent.status)
              return {
                id: intent.id,
                status: mapped,
                amountCharged: mapped === 'succeeded' ? intent.amount_received : 0,
                // Surface the client_secret only on requires_action — the
                // frontend uses it with stripe.confirmCardPayment to
                // complete the 3DS challenge. Other statuses don't need
                // it and we don't want to leak the value into unrelated
                // audit logs.
                clientSecret: mapped === 'requires_action' ? (intent.client_secret ?? null) : null
              }
            } catch (error) {
              // Stripe surfaces card declines as `StripeCardError`. Treat
              // those as a non-exceptional "card declined" result so the
              // auto-recharge attempt row is updated rather than retried.
              // StripeCardError can also mean "off-session authentication
              // required" — surface the client_secret in that case so
              // the consumer can decide whether to treat it as a 3DS
              // challenge instead of a hard decline.
              if (error instanceof Stripe.errors.StripeCardError) {
                const failedIntent = readFailedPaymentIntentDetails(error.payment_intent)
                const failedIntentId = failedIntent?.id ?? ''
                const isAuthRequired =
                  error.code === 'authentication_required' ||
                  failedIntent?.status === 'requires_action'
                return {
                  id: failedIntentId,
                  status: isAuthRequired
                    ? ('requires_action' as const)
                    : ('requires_payment_method' as const),
                  amountCharged: 0,
                  clientSecret: isAuthRequired ? (failedIntent?.clientSecret ?? null) : null
                }
              }
              throw error instanceof Error ? error : new Error(String(error))
            }
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error)))
        })
      }),

    resolvePlanFromPriceIds: (priceIds) => {
      for (const priceId of priceIds) {
        const slug = priceIdToSlug.get(priceId)
        if (slug) {
          return slug
        }
      }

      return 'pro'
    }
  })
}
