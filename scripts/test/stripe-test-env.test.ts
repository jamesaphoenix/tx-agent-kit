import { describe, expect, it } from 'vitest'
import {
  applyStripeIntegrationTestEnv,
  resolveStripeIntegrationTestMode,
  stripeIntegrationTestEnvOverrides,
  stripeStubPriceIds
} from './stripe-test-env.js'

describe('stripe integration test env', () => {
  it('defaults to stub mode and strips live Stripe secrets', () => {
    const env: Record<string, string | undefined> = {
      STRIPE_SECRET_KEY: 'live-secret-value',
      STRIPE_WEBHOOK_SECRET: 'live-webhook-secret',
      STRIPE_TRY_ME_PRICE_ID: 'price_live_try_me',
      STRIPE_PRO_PRICE_ID: 'price_live_pro',
      STRIPE_AGENCY_PRICE_ID: 'price_live_agency'
    }

    expect(applyStripeIntegrationTestEnv(env)).toBe('stub')
    expect(env).toEqual({
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_TRY_ME_PRICE_ID: stripeStubPriceIds.tryMe,
      STRIPE_PRO_PRICE_ID: stripeStubPriceIds.pro,
      STRIPE_AGENCY_PRICE_ID: stripeStubPriceIds.agency
    })
  })

  it('preserves live Stripe env only when explicitly opted in', () => {
    const env: Record<string, string | undefined> = {
      RUN_LIVE_STRIPE_INTEGRATION: '1',
      STRIPE_SECRET_KEY: 'live-secret-value',
      STRIPE_WEBHOOK_SECRET: 'live-webhook-secret',
      STRIPE_PRO_PRICE_ID: 'price_live_pro'
    }

    expect(resolveStripeIntegrationTestMode(env)).toBe('live')
    expect(applyStripeIntegrationTestEnv(env)).toBe('live')
    expect(stripeIntegrationTestEnvOverrides(env)).toEqual({})
    expect(env.STRIPE_SECRET_KEY).toBe('live-secret-value')
    expect(env.STRIPE_WEBHOOK_SECRET).toBe('live-webhook-secret')
    expect(env.STRIPE_PRO_PRICE_ID).toBe('price_live_pro')
  })
})
