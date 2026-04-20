import { Effect, Layer, Option } from 'effect'
import { AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS } from '@tx-agent-kit/contracts'
import { describe, expect, it } from 'vitest'
import { badRequest, type CoreError } from '../../../errors.js'
import type { BillingSettingsRecord } from '../domain/billing-domain.js'
import {
  AutoRechargeAttemptStorePort,
  BillingGuardPort,
  BillingStorePort,
  ClockPort,
  CreditLedgerStorePort,
  CreditServicePort,
  ProcessedStripeEventStorePort,
  StripePort,
  SubscriptionEventStorePort,
  UsageStorePort
} from '../ports/billing-ports.js'
import { BillingService, BillingServiceLive } from './billing-service.js'

const fixedDate = /* @__PURE__ */ (() => {
  const D = Date
  return new D('2026-04-16T12:00:00.000Z')
})()

const runEffectPromise = Effect.runPromise

const makeBillingRow = (): BillingSettingsRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  ownerUserId: '22222222-2222-4222-8222-222222222222',
  billingEmail: 'billing@example.com',
  stripeCustomerId: 'cus_test',
  stripeSubscriptionId: 'sub_test',
  stripePaymentMethodId: 'pm_test',
  stripeMeteredSubscriptionItemId: null,
  usageCap: null,
  creditsBalance: 10_000,
  reservedCredits: 0,
  autoRechargeEnabled: true,
  autoRechargeThreshold: 50_000,
  autoRechargeAmount: 500_000,
  isSubscribed: true,
  subscriptionStatus: 'active',
  subscriptionPlan: 'pro',
  subscriptionStartedAt: fixedDate,
  subscriptionEndsAt: null,
  subscriptionCurrentPeriodEnd: fixedDate,
  paymentGracePeriodEndsAt: null,
  suspendedAt: null,
  welcomeCreditGrantedAt: null
})

const unused = (label: string): Effect.Effect<never, Error> =>
  Effect.fail(new Error(`not used in test: ${label}`))

const unusedCore = (label: string): Effect.Effect<never, CoreError> =>
  Effect.fail(badRequest(`not used in test: ${label}`))

const makeServiceLayer = (callOrder: Array<string>) =>
  Layer.mergeAll(
    BillingServiceLive,
    Layer.succeed(BillingStorePort, {
      getSubscriptionFields: () => Effect.succeed(Option.some(makeBillingRow())),
      findByStripeCustomerId: () => Effect.succeed(Option.none()),
      findByStripeSubscriptionId: () => Effect.succeed(Option.none()),
      updateSubscriptionFields: () => unused('updateSubscriptionFields'),
      updateBillingSettings: (input) =>
        Effect.sync(() => {
          callOrder.push(`update-settings:${input.organizationId}`)
          return Option.some(makeBillingRow())
        }),
      claimStripeCustomerId: () => unused('claimStripeCustomerId'),
      getMemberRole: () => Effect.succeed(Option.some('admin' as const))
    }),
    Layer.succeed(StripePort, {
      createCheckoutSession: () => unused('createCheckoutSession'),
      createPortalSession: () => unused('createPortalSession'),
      createTopUpSession: () => unused('createTopUpSession'),
      constructWebhookEvent: () => unused('constructWebhookEvent'),
      createCustomer: () => unused('createCustomer'),
      createOffSessionPaymentIntent: (input) =>
        Effect.sync(() => {
          callOrder.push(`stripe:${input.idempotencyKey}`)
          return {
            id: 'pi_test_auto_recharge',
            status: 'succeeded' as const,
            amountCharged: input.amountDecimillicents,
            clientSecret: null
          }
        }),
      resolvePlanFromPriceIds: () => 'pro' as const
    }),
    Layer.succeed(CreditServicePort, {
      reserve: () => unusedCore('reserve'),
      finalize: () => unusedCore('finalize'),
      release: () => unusedCore('release'),
      getAvailableBalance: () => unusedCore('getAvailableBalance'),
      creditsPurchased: () => unusedCore('creditsPurchased'),
      creditsRecharged: (input) =>
        Effect.sync(() => {
          callOrder.push(`credit:${input.referenceId}`)
          return { newBalance: 510_000 }
        }),
      releaseStaleReservations: () => unusedCore('releaseStaleReservations')
    }),
    Layer.succeed(AutoRechargeAttemptStorePort, {
      findLatestRequiresActionChallenge: () => Effect.succeed(null),
      markAttemptSucceeded: (attemptId) =>
        Effect.sync(() => {
          callOrder.push(`mark-succeeded:${attemptId}`)
        }),
      markAttemptFailed: () => unused('markAttemptFailed'),
      markAttemptRequiresActionAndEmit: () => unused('markAttemptRequiresActionAndEmit')
    }),
    Layer.succeed(UsageStorePort, {
      record: () => unused('record'),
      updateStripeUsageRecordId: () => unused('updateStripeUsageRecordId'),
      findByReferenceId: () => unused('findByReferenceId'),
      listForOrganization: () => unused('listForOrganization'),
      summarizeForPeriod: () => unused('summarizeForPeriod')
    }),
    Layer.succeed(CreditLedgerStorePort, {
      append: () => unused('append'),
      finalizeReservation: () => unused('finalizeReservation'),
      listForOrganization: () => unused('listForOrganization'),
      existsByStripeEventId: () => unused('existsByStripeEventId')
    }),
    Layer.succeed(ProcessedStripeEventStorePort, {
      tryInsert: () => unused('tryInsert'),
      findById: () => unused('findById'),
      deleteByEventId: () => unused('deleteByEventId')
    }),
    Layer.succeed(SubscriptionEventStorePort, {
      findByStripeEventId: () => unused('findByStripeEventId'),
      create: () => unused('create'),
      markProcessed: () => unused('markProcessed')
    }),
    Layer.succeed(BillingGuardPort, {
      isEnabled: () => Effect.succeed(false)
    }),
    Layer.succeed(ClockPort, {
      now: () => Effect.succeed(fixedDate)
    })
  )

describe('BillingService.chargeAutoRecharge', () => {
  it('credits the local wallet before marking the auto-recharge attempt succeeded', async () => {
    const callOrder: Array<string> = []

    await runEffectPromise(
      Effect.gen(function* () {
        const billing = yield* BillingService
        return yield* billing.chargeAutoRecharge({
          organizationId: '11111111-1111-4111-8111-111111111111',
          attemptId: '33333333-3333-4333-8333-333333333333',
          amountDecimillicents: 500_000
        })
      }).pipe(Effect.provide(makeServiceLayer(callOrder)))
    )

    expect(callOrder).toEqual([
      'stripe:33333333-3333-4333-8333-333333333333',
      'credit:auto-recharge:33333333-3333-4333-8333-333333333333',
      'mark-succeeded:33333333-3333-4333-8333-333333333333'
    ])
  })

  it('rejects unsafe integer auto-recharge amounts before calling Stripe', async () => {
    const callOrder: Array<string> = []

    const outcome = await runEffectPromise(
      Effect.gen(function* () {
        const billing = yield* BillingService
        return yield* billing.chargeAutoRecharge({
          organizationId: '11111111-1111-4111-8111-111111111111',
          attemptId: '33333333-3333-4333-8333-333333333333',
          amountDecimillicents: Number.MAX_SAFE_INTEGER + 1
        })
      }).pipe(Effect.provide(makeServiceLayer(callOrder)), Effect.either)
    )

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain(
        'chargeAutoRecharge: amountDecimillicents must be a positive integer <='
      )
    }
    expect(callOrder).toEqual([])
  })

  it('rejects auto-recharge amounts above the configured maximum before calling Stripe', async () => {
    const callOrder: Array<string> = []

    const outcome = await runEffectPromise(
      Effect.gen(function* () {
        const billing = yield* BillingService
        return yield* billing.chargeAutoRecharge({
          organizationId: '11111111-1111-4111-8111-111111111111',
          attemptId: '33333333-3333-4333-8333-333333333333',
          amountDecimillicents: AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS + 1
        })
      }).pipe(Effect.provide(makeServiceLayer(callOrder)), Effect.either)
    )

    expect(outcome._tag).toBe('Left')
    expect(callOrder).toEqual([])
  })
})

describe('BillingService.updateBillingSettings', () => {
  it.each([
    ['negative usage cap', { usageCapDecimillicents: -1 }],
    ['fractional auto-recharge threshold', { autoRechargeThresholdDecimillicents: 1.5 }],
    ['NaN auto-recharge amount', { autoRechargeAmountDecimillicents: Number.NaN }],
    ['infinite auto-recharge amount', { autoRechargeAmountDecimillicents: Number.POSITIVE_INFINITY }],
    ['unsafe usage cap', { usageCapDecimillicents: Number.MAX_SAFE_INTEGER + 1 }]
  ])('rejects invalid direct settings before writing to the store (%s)', async (_label, patch) => {
    const callOrder: Array<string> = []

    const outcome = await runEffectPromise(
      Effect.gen(function* () {
        const billing = yield* BillingService
        return yield* billing.updateBillingSettings(
          { userId: '22222222-2222-4222-8222-222222222222' },
          '11111111-1111-4111-8111-111111111111',
          patch
        )
      }).pipe(Effect.provide(makeServiceLayer(callOrder)), Effect.either)
    )

    expect(outcome._tag).toBe('Left')
    expect(callOrder).toEqual([])
  })

  it.each([
    ['amount', { autoRechargeAmountDecimillicents: null }],
    ['threshold', { autoRechargeThresholdDecimillicents: null }]
  ])('rejects clearing the auto-recharge %s while auto-recharge remains enabled', async (_label, patch) => {
    const callOrder: Array<string> = []

    const outcome = await runEffectPromise(
      Effect.gen(function* () {
        const billing = yield* BillingService
        return yield* billing.updateBillingSettings(
          { userId: '22222222-2222-4222-8222-222222222222' },
          '11111111-1111-4111-8111-111111111111',
          patch
        )
      }).pipe(Effect.provide(makeServiceLayer(callOrder)), Effect.either)
    )

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain('Enabling auto-recharge requires both')
    }
    expect(callOrder).not.toContain('update-settings:11111111-1111-4111-8111-111111111111')
  })
})
