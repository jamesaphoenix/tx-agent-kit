import { StripePort, type StripeWebhookEvent } from '@tx-agent-kit/core'
import { Effect, Layer } from 'effect'
import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { getApiEnv } from '../config/env.js'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
interface JsonObject {
  [key: string]: JsonValue
}

const toJsonValue = (value: unknown): JsonValue => {
  if (value === null) {
    return null
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry))
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    const mapped: JsonObject = {}
    for (const [key, child] of entries) {
      mapped[key] = toJsonValue(child)
    }
    return mapped
  }

  return null
}

const toJsonObject = (value: unknown): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  const result: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    result[key] = toJsonValue(child)
  }
  return result
}

const resolveStripeClient = (): Stripe | null => {
  const env = getApiEnv()
  if (!env.STRIPE_SECRET_KEY) {
    return null
  }

  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-10-29.clover'
  })
}

const requireProPriceIds = (): Effect.Effect<{ proPriceId: string; meteredPriceId: string }, Error> =>
  Effect.sync(() => {
    const env = getApiEnv()
    const proPriceId = env.STRIPE_PRO_PRICE_ID
    const meteredPriceId = env.STRIPE_PRO_METERED_PRICE_ID

    if (!proPriceId || !meteredPriceId) {
      throw new Error('Stripe Pro price IDs are not configured.')
    }

    return { proPriceId, meteredPriceId }
  })

const parseWebhookEventWithoutVerification = (rawBody: string): StripeWebhookEvent => {
  const parsed = JSON.parse(rawBody) as unknown
  const payload = toJsonObject(parsed)
  const eventId = typeof payload.id === 'string' ? payload.id : 'local-webhook-event'
  const eventType = typeof payload.type === 'string' ? payload.type : 'unknown'
  const data = toJsonObject(payload.data)

  return {
    id: eventId,
    type: eventType,
    payload,
    data: {
      object: toJsonObject(data.object)
    }
  }
}

const readStringMember = (value: unknown, key: string): string | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const maybe = (value as Record<string, unknown>)[key]
  return typeof maybe === 'string' ? maybe : null
}

export const StripePortLive = Layer.succeed(StripePort, {
  createCheckoutSession: (input) =>
    Effect.gen(function* () {
      const stripe = resolveStripeClient()
      if (!stripe) {
        return {
          id: `cs_local_${randomUUID()}`,
          url: `${input.successUrl}?session_id=cs_local`
        }
      }

      const prices = yield* requireProPriceIds()

      return yield* Effect.tryPromise({
        try: async () => {
          const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: input.customerId,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            client_reference_id: input.organizationId,
            metadata: {
              organizationId: input.organizationId
            },
            subscription_data: {
              metadata: {
                organizationId: input.organizationId
              }
            },
            line_items: [
              {
                price: prices.proPriceId,
                quantity: 1
              },
              {
                price: prices.meteredPriceId
              }
            ]
          })

          if (!session.url) {
            throw new Error('Stripe checkout session did not include a redirect URL.')
          }

          return {
            id: session.id,
            url: session.url
          }
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
    }),

  createPortalSession: (input) =>
    Effect.gen(function* () {
      const stripe = resolveStripeClient()
      if (!stripe) {
        return {
          id: `bps_local_${randomUUID()}`,
          url: input.returnUrl
        }
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const session = await stripe.billingPortal.sessions.create({
            customer: input.customerId,
            return_url: input.returnUrl
          })

          return {
            id: session.id,
            url: session.url
          }
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
    }),

  constructWebhookEvent: (rawBody: string, signature: string) =>
    Effect.gen(function* () {
      const env = getApiEnv()
      const stripe = resolveStripeClient()
      const webhookSecret = env.STRIPE_WEBHOOK_SECRET

      if (!stripe || !webhookSecret) {
        return yield* Effect.sync(() => parseWebhookEventWithoutVerification(rawBody))
      }

      return yield* Effect.try({
        try: () => {
          const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
          const payload = toJsonObject(event as unknown)
          const eventData = (event.data as { object: unknown }).object
          return {
            id: event.id,
            type: event.type,
            payload,
            data: {
              object: toJsonObject(eventData)
            }
          } satisfies StripeWebhookEvent
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
    }),

  createCustomer: (input) =>
    Effect.gen(function* () {
      const stripe = resolveStripeClient()
      if (!stripe) {
        return { id: `cus_local_${input.organizationId}` }
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const customer = await stripe.customers.create({
            email: input.email,
            metadata: {
              organizationId: input.organizationId
            }
          })

          return { id: customer.id }
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
    }),

  reportUsage: (input) =>
    Effect.gen(function* () {
      const env = getApiEnv()
      if (!env.STRIPE_SECRET_KEY) {
        return { id: `usage_${randomUUID()}` }
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const body = new URLSearchParams()
          body.set('quantity', String(input.quantity))
          body.set('action', 'increment')
          body.set('timestamp', String(Math.floor(input.timestamp.getTime() / 1000)))

          const response = await fetch(
            `https://api.stripe.com/v1/subscription_items/${encodeURIComponent(input.subscriptionItemId)}/usage_records`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {})
              },
              body
            }
          )

          if (!response.ok) {
            const message = await response.text()
            throw new Error(
              `Stripe usage report failed with status ${response.status}${message ? `: ${message}` : ''}`
            )
          }

          const payload: unknown = await response.json()
          const usageRecordId = readStringMember(payload, 'id')
          if (!usageRecordId) {
            throw new Error('Stripe usage report response did not include an id.')
          }

          return { id: usageRecordId }
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
    })
})
