import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import type { BillingSettingsRecord } from '../domain/billing-domain.js'
import { BillingStorePort, CreditLedgerStorePort } from '../ports/billing-ports.js'
import { StaleReservationReaderPort } from '../ports/credit-reclaim-ports.js'
import { makeCreditService } from './credit-service.js'

const fixedDate = /* @__PURE__ */ (() => new Date('2026-04-16T12:00:00.000Z'))()

const runEffectPromise = Effect.runPromise

const unused = (label: string): Effect.Effect<never, Error> =>
  Effect.fail(new Error(`not used in test: ${label}`))

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
  autoRechargeEnabled: false,
  autoRechargeThreshold: null,
  autoRechargeAmount: null,
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

const makeServiceLayer = (calls: Array<string>) =>
  Layer.mergeAll(
    Layer.succeed(BillingStorePort, {
      getSubscriptionFields: () => Effect.succeed(Option.some(makeBillingRow())),
      findByStripeCustomerId: () => unused('findByStripeCustomerId'),
      findByStripeSubscriptionId: () => unused('findByStripeSubscriptionId'),
      updateSubscriptionFields: () => unused('updateSubscriptionFields'),
      updateBillingSettings: () => unused('updateBillingSettings'),
      claimStripeCustomerId: () => unused('claimStripeCustomerId'),
      getMemberRole: () => unused('getMemberRole')
    }),
    Layer.succeed(CreditLedgerStorePort, {
      append: () => unused('append'),
      finalizeReservation: () => unused('finalizeReservation'),
      listForOrganization: () => unused('listForOrganization'),
      existsByStripeEventId: () => unused('existsByStripeEventId')
    }),
    Layer.succeed(StaleReservationReaderPort, {
      findStaleReservations: () =>
        Effect.sync(() => {
          calls.push('findStaleReservations')
          return []
        }),
      tryReleaseStaleReservation: () => unused('tryReleaseStaleReservation')
    })
  )

describe('CreditService.releaseStaleReservations', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1]
  ])('rejects invalid maxAgeSeconds (%s) before scanning stale reservations', async (_label, maxAgeSeconds) => {
    const calls: Array<string> = []

    const outcome = await runEffectPromise(
      Effect.gen(function* () {
        const service = yield* makeCreditService
        return yield* service.releaseStaleReservations(maxAgeSeconds)
      }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
    )

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain('maxAgeSeconds must be a positive integer')
    }
    expect(calls).toEqual([])
  })
})

describe('CreditService money amount validation', () => {
  it.each([
    ['reserve', async () => {
      const calls: Array<string> = []
      return runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeCreditService
          return yield* service.reserve({
            organizationId: 'org-1',
            estimatedCostDecimillicents: Number.MAX_SAFE_INTEGER + 1,
            referenceId: 'reserve-unsafe',
            reason: 'unsafe reserve'
          })
        }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
      )
    }, 'reserve: estimatedCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER'],
    ['finalize estimated amount', async () => {
      const calls: Array<string> = []
      return runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeCreditService
          return yield* service.finalize({
            organizationId: 'org-1',
            reservationId: 'reservation-1',
            estimatedCostDecimillicents: Number.MAX_SAFE_INTEGER + 1,
            actualCostDecimillicents: 10,
            marginMultiplier: 1
          })
        }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
      )
    }, 'finalize: estimatedCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER'],
    ['finalize actual amount', async () => {
      const calls: Array<string> = []
      return runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeCreditService
          return yield* service.finalize({
            organizationId: 'org-1',
            reservationId: 'reservation-1',
            estimatedCostDecimillicents: 10,
            actualCostDecimillicents: Number.MAX_SAFE_INTEGER + 1,
            marginMultiplier: 1
          })
        }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
      )
    }, 'finalize: actualCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER'],
    ['release', async () => {
      const calls: Array<string> = []
      return runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeCreditService
          return yield* service.release({
            organizationId: 'org-1',
            reservationId: 'reservation-1',
            estimatedCostDecimillicents: Number.MAX_SAFE_INTEGER + 1,
            reason: 'unsafe release'
          })
        }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
      )
    }, 'release: estimatedCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER'],
    ['creditsPurchased', async () => {
      const calls: Array<string> = []
      return runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeCreditService
          return yield* service.creditsPurchased({
            organizationId: 'org-1',
            amountDecimillicents: Number.MAX_SAFE_INTEGER + 1,
            stripeEventId: 'evt_unsafe_purchase',
            referenceId: 'unsafe-purchase',
            reason: 'unsafe purchase'
          })
        }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
      )
    }, 'creditsPurchased: amountDecimillicents must be a positive integer <= Number.MAX_SAFE_INTEGER'],
    ['creditsRecharged', async () => {
      const calls: Array<string> = []
      return runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeCreditService
          return yield* service.creditsRecharged({
            organizationId: 'org-1',
            amountDecimillicents: Number.MAX_SAFE_INTEGER + 1,
            stripePaymentIntentId: 'pi_unsafe',
            stripeEventId: 'evt_unsafe_recharge',
            referenceId: 'unsafe-recharge',
            reason: 'unsafe recharge'
          })
        }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
      )
    }, 'creditsRecharged: amountDecimillicents must be a positive integer <= Number.MAX_SAFE_INTEGER']
  ])('rejects unsafe integer decimillicents for %s before touching the ledger', async (_label, run, message) => {
    const outcome = await run()

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain(message)
    }
  })

  it('rejects finalized margin costs that overflow Number.MAX_SAFE_INTEGER before touching the ledger', async () => {
    const calls: Array<string> = []

    const outcome = await runEffectPromise(
      Effect.gen(function* () {
        const service = yield* makeCreditService
        return yield* service.finalize({
          organizationId: 'org-1',
          reservationId: 'reservation-1',
          estimatedCostDecimillicents: 10,
          actualCostDecimillicents: Number.MAX_SAFE_INTEGER,
          marginMultiplier: 1.1
        })
      }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
    )

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain('finalize: finalCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER')
    }
  })

  it.each([
    ['creditsPurchased', async () => {
      const calls: Array<string> = []
      return runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeCreditService
          return yield* service.creditsPurchased({
            organizationId: 'org-1',
            amountDecimillicents: 0,
            stripeEventId: 'evt_zero_purchase',
            referenceId: 'zero-purchase',
            reason: 'zero purchase'
          })
        }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
      )
    }, 'creditsPurchased: amountDecimillicents must be a positive integer <= Number.MAX_SAFE_INTEGER'],
    ['creditsRecharged', async () => {
      const calls: Array<string> = []
      return runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeCreditService
          return yield* service.creditsRecharged({
            organizationId: 'org-1',
            amountDecimillicents: 0,
            stripePaymentIntentId: 'pi_zero',
            stripeEventId: 'evt_zero_recharge',
            referenceId: 'zero-recharge',
            reason: 'zero recharge'
          })
        }).pipe(Effect.provide(makeServiceLayer(calls)), Effect.either)
      )
    }, 'creditsRecharged: amountDecimillicents must be a positive integer <= Number.MAX_SAFE_INTEGER']
  ])('rejects zero-value %s events before emitting ledger/outbox rows', async (_label, run, message) => {
    const outcome = await run()

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain(message)
    }
  })
})
