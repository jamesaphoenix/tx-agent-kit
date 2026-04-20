import type { SubscriptionPlanSlug } from '@tx-agent-kit/contracts'

export interface StripeCheckoutPriceIds {
  readonly recurring: string | undefined
}

/**
 * Configuration passed to {@link makeStripePortLive}. The factory reads
 * nothing from the node environment directly — callers (apps/api, apps/worker,
 * tests) are responsible for resolving each field via their own env
 * module so that env-access invariants stay localised.
 *
 * All fields are optional. Missing fields cause the matching StripePort
 * methods to take the config-gated fallback path:
 *   - In development/test this is a deterministic `*_local_*` stub that
 *     lets integration tests exercise the full code path without a real
 *     Stripe account.
 *   - In production a missing field that the method actually needs causes
 *     the method to `Effect.fail` with a clear error — NEVER `Effect.die`,
 *     so a misconfigured route surfaces as a 4xx/5xx, not a crashed worker.
 *
 * @spec billing-and-pricing-design
 */
export interface StripePortConfig {
  /** Stripe secret key (`sk_test_...` / `sk_live_...`). Absence puts the
   *  factory in stub mode — every method returns a deterministic local
   *  placeholder. */
  readonly secretKey: string | undefined
  /** Stripe webhook signing secret (`whsec_...`). Required by
   *  `constructWebhookEvent` outside dev/test; absence in prod is a fatal
   *  misconfiguration and that method will fail. */
  readonly webhookSecret: string | undefined
  /** Per-plan Stripe Price ids for the recurring subscription fee consumed by
   *  `createCheckoutSession`. Credits and auto-recharge are accounted for in
   *  the local ledger, not Stripe metered subscription items. */
  readonly checkoutPriceIds: Record<SubscriptionPlanSlug, StripeCheckoutPriceIds>
  /** `'development'` / `'test'` / `'production'`. Controls whether
   *  webhook signature verification is required and whether the in-prod
   *  failure modes turn into stubs. */
  readonly nodeEnv: string
}
