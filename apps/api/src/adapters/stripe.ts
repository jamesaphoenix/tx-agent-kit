import type { StripePort } from '@tx-agent-kit/core'
import { makeStripePortLive, type StripePortConfig } from '@tx-agent-kit/stripe'
import { Layer } from 'effect'
import { getApiEnv } from '../config/env.js'

/**
 * API-side Stripe adapter.
 *
 * The actual implementation lives in `@tx-agent-kit/stripe` so the worker
 * and the API server share one source of truth for the Stripe Port
 * wiring. This module is a thin shim: it resolves the api env and hands
 * the config to {@link makeStripePortLive}.
 *
 * The layer is evaluated lazily via `Layer.suspend` so `getApiEnv()`
 * (which can throw on missing required vars) only runs when the layer is
 * actually provided — never at module import time.
 *
 * @spec billing-and-pricing-design
 */

let cachedStripePortLive: Layer.Layer<StripePort> | null = null

const resolveStripePortConfig = (): StripePortConfig => {
  const env = getApiEnv()
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    checkoutPriceIds: {
      try_me: {
        recurring: env.STRIPE_TRY_ME_PRICE_ID
      },
      pro: {
        recurring: env.STRIPE_PRO_PRICE_ID
      },
      agency: {
        recurring: env.STRIPE_AGENCY_PRICE_ID
      }
    },
    nodeEnv: env.NODE_ENV
  }
}

const getStripePortLive = (): Layer.Layer<StripePort> => {
  cachedStripePortLive ??= makeStripePortLive(resolveStripePortConfig())
  return cachedStripePortLive
}

/**
 * Test hook: resets the cached adapter so a subsequent call picks up a
 * freshly stubbed env. Used by integration tests that flip env vars
 * between runs.
 */
export const _resetStripePortLiveForTest = (): void => {
  cachedStripePortLive = null
}

export const StripePortLive: Layer.Layer<StripePort> = Layer.suspend(() =>
  getStripePortLive()
)
