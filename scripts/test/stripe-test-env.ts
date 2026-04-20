export const stripeStubPriceIds = {
  tryMe: 'price_stub_try_me',
  pro: 'price_stub_pro',
  agency: 'price_stub_agency'
} as const

export type StripeIntegrationTestMode = 'stub' | 'live'

type MutableEnv = Record<string, string | undefined>

export const resolveStripeIntegrationTestMode = (
  env: MutableEnv = process.env
): StripeIntegrationTestMode =>
  env.RUN_LIVE_STRIPE_INTEGRATION === '1' ? 'live' : 'stub'

/**
 * Normal integration tests must not inherit live Stripe credentials from
 * .env/1Password. Live Stripe coverage is explicit-only via
 * RUN_LIVE_STRIPE_INTEGRATION=1.
 */
export const applyStripeIntegrationTestEnv = (
  env: MutableEnv = process.env
): StripeIntegrationTestMode => {
  const mode = resolveStripeIntegrationTestMode(env)
  if (mode === 'live') {
    return mode
  }

  env.STRIPE_SECRET_KEY = ''
  env.STRIPE_WEBHOOK_SECRET = ''
  env.STRIPE_TRY_ME_PRICE_ID = stripeStubPriceIds.tryMe
  env.STRIPE_PRO_PRICE_ID = stripeStubPriceIds.pro
  env.STRIPE_AGENCY_PRICE_ID = stripeStubPriceIds.agency

  return mode
}

export const stripeIntegrationTestEnvOverrides = (
  env: MutableEnv = process.env
): Record<string, string> =>
  resolveStripeIntegrationTestMode(env) === 'live'
    ? {}
    : {
        STRIPE_SECRET_KEY: '',
        STRIPE_WEBHOOK_SECRET: '',
        STRIPE_TRY_ME_PRICE_ID: stripeStubPriceIds.tryMe,
        STRIPE_PRO_PRICE_ID: stripeStubPriceIds.pro,
        STRIPE_AGENCY_PRICE_ID: stripeStubPriceIds.agency
      }
