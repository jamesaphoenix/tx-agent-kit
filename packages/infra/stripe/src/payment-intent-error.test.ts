import { StripePort } from '@tx-agent-kit/core'
import { Effect, Exit } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFailedPaymentIntentDetails } from './payment-intent-error.js'
import { makeStripePortLive } from './port-live.js'
import { makeWorkerStripePortLive } from './worker-port-live.js'

describe('readFailedPaymentIntentDetails', () => {
  it('normalizes usable failed payment intent fields', () => {
    expect(readFailedPaymentIntentDetails({
      id: 'pi_failed',
      status: 'requires_action',
      client_secret: 'pi_failed_secret'
    })).toEqual({
      id: 'pi_failed',
      status: 'requires_action',
      clientSecret: 'pi_failed_secret'
    })
  })

  it('returns safe defaults for malformed failed payment intent payloads', () => {
    expect(readFailedPaymentIntentDetails({
      id: 123,
      status: false,
      client_secret: null
    })).toEqual({
      id: '',
      status: null,
      clientSecret: null
    })
  })

  it('ignores absent or non-object failed payment intent payloads', () => {
    expect(readFailedPaymentIntentDetails(null)).toBeNull()
    expect(readFailedPaymentIntentDetails('pi_failed')).toBeNull()
  })
})

const stripeMockState = vi.hoisted(() => {
  const paymentIntentsCreateMock = vi.fn()

  class MockStripeCardError extends Error {
    readonly code: string
    readonly payment_intent: unknown

    constructor(code: string, paymentIntent: unknown) {
      super('Stripe card error')
      this.code = code
      this.payment_intent = paymentIntent
    }
  }

  class MockStripe {
    static readonly errors = {
      StripeCardError: MockStripeCardError
    }

    readonly paymentIntents = {
      create: paymentIntentsCreateMock
    }
  }

  return { MockStripe, MockStripeCardError, paymentIntentsCreateMock }
})

vi.mock('stripe', () => ({
  default: stripeMockState.MockStripe
}))

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

const offSessionInput = {
  organizationId: 'org-1',
  customerId: 'cus_test',
  paymentMethodId: 'pm_test',
  amountDecimillicents: 1_000_000,
  description: 'auto recharge',
  idempotencyKey: 'attempt-1'
}

describe('StripeCardError failed payment intent handling', () => {
  beforeEach(() => {
    stripeMockState.paymentIntentsCreateMock.mockReset()
  })

  it('maps authentication-required card errors with client secret on the api adapter', async () => {
    stripeMockState.paymentIntentsCreateMock.mockRejectedValueOnce(
      new stripeMockState.MockStripeCardError('authentication_required', {
        id: 'pi_requires_action',
        status: 'requires_action',
        client_secret: 'pi_requires_action_secret'
      })
    )

    const layer = makeStripePortLive({
      secretKey: 'sk_test_mock',
      webhookSecret: undefined,
      checkoutPriceIds: {
        try_me: { recurring: undefined },
        pro: { recurring: undefined },
        agency: { recurring: undefined }
      },
      nodeEnv: 'test'
    })

    const exit = await runPortEffect(layer, (port) =>
      port.createOffSessionPaymentIntent(offSessionInput)
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        id: 'pi_requires_action',
        status: 'requires_action',
        amountCharged: 0,
        clientSecret: 'pi_requires_action_secret'
      })
    }
  })

  it('maps malformed card-error payment intent payloads without throwing', async () => {
    stripeMockState.paymentIntentsCreateMock.mockRejectedValueOnce(
      new stripeMockState.MockStripeCardError('card_declined', 'pi_legacy_string')
    )

    const layer = makeWorkerStripePortLive({ secretKey: 'sk_test_mock' })

    const exit = await runPortEffect(layer, (port) =>
      port.createOffSessionPaymentIntent(offSessionInput)
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        id: '',
        status: 'requires_payment_method',
        amountCharged: 0,
        clientSecret: null
      })
    }
  })
})
