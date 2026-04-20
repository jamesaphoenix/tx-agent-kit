import { StripePort } from '@tx-agent-kit/core'
import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeStripePortLive } from './port-live.js'
import { makeWorkerStripePortLive } from './worker-port-live.js'

/**
 * Extract the error message from an Effect Cause for assertion. Plain
 * `JSON.stringify` serializes `Error` instances as `{}` which hides the
 * message; `Cause.pretty` prints the rendered error text.
 */
const causeText = (cause: Cause.Cause<unknown>): string => Cause.pretty(cause)

/**
 * Unit tests for the StripePort factories. All tests run in the zero-config
 * "no secret key" mode — each public method should return a deterministic
 * stub in dev/test so integration tests can exercise the full billing code
 * path without a live Stripe account.
 *
 * @spec billing-and-pricing-design
 */

const runPortEffect = <A, E>(
  layer: ReturnType<typeof makeStripePortLive>,
  program: (
    port: Effect.Effect.Success<typeof StripePort>
  ) => Effect.Effect<A, E>
): Promise<Exit.Exit<A, E>> => {
  const effect = Effect.gen(function* () {
    const port = yield* StripePort
    return yield* program(port)
  }).pipe(Effect.provide(layer), Effect.exit)
  return Effect.runPromise(effect)
}

describe('makeStripePortLive — stub fallbacks (no secret key)', () => {
  const stubLayer = makeStripePortLive({
    secretKey: undefined,
    webhookSecret: undefined,
    checkoutPriceIds: {
      try_me: { recurring: undefined },
      pro: { recurring: undefined },
      agency: { recurring: undefined }
    },
    nodeEnv: 'test'
  })

  it('createCheckoutSession returns a deterministic cs_local stub', async () => {
    const exit = await runPortEffect(stubLayer, (port) =>
      port.createCheckoutSession({
        organizationId: 'org-1',
        subscriptionPlan: 'pro',
        successUrl: 'https://example.test/ok',
        cancelUrl: 'https://example.test/cancel',
        customerId: 'cus_local_test'
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.id).toMatch(/^cs_local_/)
      expect(exit.value.url).toBe('https://example.test/ok?session_id=cs_local')
    }
  })

  it('createPortalSession returns the return URL verbatim', async () => {
    const exit = await runPortEffect(stubLayer, (port) =>
      port.createPortalSession({
        organizationId: 'org-1',
        returnUrl: 'https://example.test/back',
        customerId: 'cus_local_test'
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.url).toBe('https://example.test/back')
    }
  })

  it('createTopUpSession returns a deterministic cs_topup_local stub', async () => {
    const exit = await runPortEffect(stubLayer, (port) =>
      port.createTopUpSession({
        organizationId: 'org-1',
        customerId: 'cus_local_test',
        amountDecimillicents: 5_000_000,
        successUrl: 'https://example.test/ok',
        cancelUrl: 'https://example.test/cancel'
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.id).toMatch(/^cs_topup_local_/)
    }
  })

  it('createCustomer returns cus_local_<organizationId>', async () => {
    const exit = await runPortEffect(stubLayer, (port) =>
      port.createCustomer({ organizationId: 'org-abc', email: 'user@example.test' })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.id).toBe('cus_local_org-abc')
    }
  })

  it('constructWebhookEvent parses the body without signature verification in test mode', async () => {
    const rawBody = JSON.stringify({
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_456' } }
    })
    const exit = await runPortEffect(stubLayer, (port) =>
      port.constructWebhookEvent(rawBody, 'unverified')
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.id).toBe('evt_test_123')
      expect(exit.value.type).toBe('checkout.session.completed')
    }
  })

  it('createOffSessionPaymentIntent returns pi_local with succeeded status', async () => {
    const exit = await runPortEffect(stubLayer, (port) =>
      port.createOffSessionPaymentIntent({
        organizationId: 'org-1',
        customerId: 'cus_local_test',
        paymentMethodId: 'pm_local_test',
        amountDecimillicents: 5_000_000,
        description: 'test',
        idempotencyKey: 'attempt-1'
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.id).toMatch(/^pi_local_/)
      expect(exit.value.status).toBe('succeeded')
      expect(exit.value.amountCharged).toBe(50) // 5_000_000 decimillicents → 50 cents
    }
  })

})

describe('makeStripePortLive — fail (not die) when required config missing', () => {
  it('createCheckoutSession with a configured secret key but missing price ids fails with a descriptive error', async () => {
    const layer = makeStripePortLive({
      secretKey: 'sk_test_fake_123',
      webhookSecret: undefined,
      checkoutPriceIds: {
        try_me: { recurring: undefined },
        pro: { recurring: undefined },
        agency: { recurring: undefined }
      },
      nodeEnv: 'test'
    })

    // We can't actually call Stripe.checkout.sessions.create without
    // network, but the layer should reach the price-id check BEFORE
    // hitting Stripe and fail there.
    const exit = await runPortEffect(layer, (port) =>
      port.createCheckoutSession({
        organizationId: 'org-1',
        subscriptionPlan: 'pro',
        successUrl: 'https://example.test/ok',
        cancelUrl: 'https://example.test/cancel',
        customerId: 'cus_test'
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      // The failure is an Error — assert the message. Crucially, the
      // factory does NOT `Effect.die`, so this is a recoverable failure.
      const cause = exit.cause
      expect(causeText(cause)).toContain('Stripe recurring price ID is not configured for plan "pro"')
    }
  })

  it('constructWebhookEvent in production with missing webhook secret fails (does not die)', async () => {
    const layer = makeStripePortLive({
      secretKey: 'sk_test_fake',
      webhookSecret: undefined,
      checkoutPriceIds: {
        try_me: { recurring: undefined },
        pro: { recurring: undefined },
        agency: { recurring: undefined }
      },
      nodeEnv: 'production'
    })

    const exit = await runPortEffect(layer, (port) =>
      port.constructWebhookEvent('{}', 'whsec-signature')
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(causeText(exit.cause)).toContain('webhook secret is not configured')
    }
  })
})

describe('makeWorkerStripePortLive — stub PaymentIntent + descriptive fail for api-only methods', () => {
  const workerStub = makeWorkerStripePortLive({ secretKey: undefined })

  it('createOffSessionPaymentIntent returns pi_local succeeded when no secret key', async () => {
    const exit = await runPortEffect(workerStub, (port) =>
      port.createOffSessionPaymentIntent({
        organizationId: 'org-1',
        customerId: 'cus_local',
        paymentMethodId: 'pm_local',
        amountDecimillicents: 1_000_000,
        description: 'test',
        idempotencyKey: 'attempt-a'
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.id).toMatch(/^pi_local_/)
      expect(exit.value.status).toBe('succeeded')
    }
  })

  it('createCheckoutSession on the worker layer fails with a descriptive error (does not die)', async () => {
    const exit = await runPortEffect(workerStub, (port) =>
      port.createCheckoutSession({
        organizationId: 'org-1',
        subscriptionPlan: 'pro',
        successUrl: 'https://example.test/ok',
        cancelUrl: 'https://example.test/cancel',
        customerId: 'cus_local_test'
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(causeText(exit.cause)).toContain('not available in the worker')
    }
  })

  it('createPortalSession on the worker layer fails with a descriptive error', async () => {
    const exit = await runPortEffect(workerStub, (port) =>
      port.createPortalSession({
        organizationId: 'org-1',
        returnUrl: 'https://example.test/back',
        customerId: 'cus_local_test'
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(causeText(exit.cause)).toContain('not available in the worker')
    }
  })

  it('createTopUpSession on the worker layer fails with a descriptive error', async () => {
    const exit = await runPortEffect(workerStub, (port) =>
      port.createTopUpSession({
        organizationId: 'org-1',
        customerId: 'cus_local_test',
        amountDecimillicents: 1_000_000,
        successUrl: 'https://example.test/ok',
        cancelUrl: 'https://example.test/cancel'
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(causeText(exit.cause)).toContain('not available in the worker')
    }
  })

  it('constructWebhookEvent on the worker layer fails with a descriptive error', async () => {
    const exit = await runPortEffect(workerStub, (port) =>
      port.constructWebhookEvent('{}', 'whsec-sig')
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(causeText(exit.cause)).toContain('not available in the worker')
    }
  })

  it('createCustomer on the worker layer fails with a descriptive error', async () => {
    const exit = await runPortEffect(workerStub, (port) =>
      port.createCustomer({ organizationId: 'org-1', email: 'u@example.test' })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(causeText(exit.cause)).toContain('not available in the worker')
    }
  })

})
