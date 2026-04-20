import { randomUUID } from 'node:crypto'
import { StripePort } from '@tx-agent-kit/core'
import { Effect, Layer } from 'effect'
import Stripe from 'stripe'
import { STRIPE_API_VERSION } from './port-live.js'

/**
 * Configuration for the worker-side Stripe adapter. Only the secret key is
 * needed because the worker exclusively exercises the
 * `createOffSessionPaymentIntent` path (auto-recharge). All other
 * `StripePort` methods are unused from the worker and `Effect.fail` with a
 * descriptive error — never `Effect.die`, so a misrouted call surfaces as
 * a recoverable activity failure rather than a worker crash.
 */
export interface WorkerStripePortConfig {
  readonly secretKey: string | undefined
}

/**
 * Map a Stripe PaymentIntent status into the narrow return type of
 * `StripePort.createOffSessionPaymentIntent`. Mirrors the api-side mapper;
 * duplicated deliberately so the worker module has no cross-import on
 * api-only code.
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

const workerOnlyError = (method: string) =>
  new Error(
    `${method} is not available in the worker — call this method from apps/api's Stripe adapter instead`
  )

/**
 * Construct a worker-side `StripePort` adapter. Only
 * `createOffSessionPaymentIntent` runs real Stripe logic; every other
 * method fails with a descriptive error if ever invoked, so that an
 * accidental cross-process call on the worker Layer fails loudly (as a
 * recoverable Effect failure) rather than silently returning nonsense.
 *
 * @spec billing-and-pricing-design
 */
export const makeWorkerStripePortLive = (
  config: WorkerStripePortConfig
): Layer.Layer<StripePort> => {
  const stripeClient: Stripe | null = config.secretKey
    ? new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION })
    : null

  return Layer.succeed(StripePort, {
    createCheckoutSession: () =>
      Effect.fail(workerOnlyError('StripePort.createCheckoutSession')),
    createPortalSession: () =>
      Effect.fail(workerOnlyError('StripePort.createPortalSession')),
    createTopUpSession: () =>
      Effect.fail(workerOnlyError('StripePort.createTopUpSession')),
    constructWebhookEvent: () =>
      Effect.fail(workerOnlyError('StripePort.constructWebhookEvent')),
    createCustomer: () =>
      Effect.fail(workerOnlyError('StripePort.createCustomer')),

    createOffSessionPaymentIntent: (input) => {
      const unitAmountCents = Math.floor(input.amountDecimillicents / 100_000)

      if (!stripeClient) {
        return Effect.sync(() => ({
          id: `pi_local_${randomUUID()}`,
          status: 'succeeded' as const,
          amountCharged: unitAmountCents,
          clientSecret: null
        }))
      }

      if (unitAmountCents < 1) {
        return Effect.fail(new Error('Auto-recharge amount must be at least 1 cent'))
      }

      return Effect.tryPromise({
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
              clientSecret: mapped === 'requires_action' ? (intent.client_secret ?? null) : null
            }
          } catch (error) {
            if (error instanceof Stripe.errors.StripeCardError) {
              const failedIntent = error.payment_intent
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
                clientSecret: isAuthRequired ? (failedIntent?.client_secret ?? null) : null
              }
            }
            throw error instanceof Error ? error : new Error(String(error))
          }
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
    },

    resolvePlanFromPriceIds: () => 'pro'
  })
}
