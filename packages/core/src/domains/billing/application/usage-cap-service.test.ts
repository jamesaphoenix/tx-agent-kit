import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { UsageCapStorePort } from '../ports/billing-ports.js'
import { makeUsageCapService } from './usage-cap-service.js'

const runEffectPromise = Effect.runPromise

const periodStart = new Date('2026-04-01T00:00:00.000Z')
const periodEnd = new Date('2026-05-01T00:00:00.000Z')

const unused = (label: string): Effect.Effect<never, Error> =>
  Effect.fail(new Error(`not used in test: ${label}`))

const makeStoreLayer = (calls: Array<string>, state?: { usageCap: number | null; creditsUsed: number }) =>
  Layer.succeed(UsageCapStorePort, {
    getOrgCapState: () =>
      Effect.sync(() => {
        calls.push('getOrgCapState')
        return Option.some({
          usageCapDecimillicents: Option.fromNullable(state?.usageCap ?? 100_000),
          creditsUsed: state?.creditsUsed ?? 10_000
        })
      }),
    incrementMonthlyUsage: () => unused('incrementMonthlyUsage'),
    incrementMonthlyUsageAndEmit: () => unused('incrementMonthlyUsageAndEmit'),
    emitUsageCapExceeded: () => unused('emitUsageCapExceeded')
  })

describe('UsageCapService safe integer validation', () => {
  it('rejects unsafe estimated costs before reading usage-cap state', async () => {
    const calls: Array<string> = []

    const outcome = await runEffectPromise(
      Effect.gen(function* () {
        const service = yield* makeUsageCapService
        return yield* service.checkUsageCaps({
          organizationId: 'org-1',
          estimatedCostDecimillicents: Number.MAX_SAFE_INTEGER + 1,
          periodStart,
          periodEnd,
          planTier: 'pro'
        })
      }).pipe(Effect.provide(makeStoreLayer(calls)), Effect.either)
    )

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain(
        'checkUsageCaps: estimatedCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER'
      )
    }
    expect(calls).toEqual([])
  })

  it('rejects usage projections that overflow Number.MAX_SAFE_INTEGER', async () => {
    const calls: Array<string> = []

    const outcome = await runEffectPromise(
      Effect.gen(function* () {
        const service = yield* makeUsageCapService
        return yield* service.checkUsageCaps({
          organizationId: 'org-1',
          estimatedCostDecimillicents: 1,
          periodStart,
          periodEnd,
          planTier: 'pro'
        })
      }).pipe(
        Effect.provide(makeStoreLayer(calls, {
          usageCap: Number.MAX_SAFE_INTEGER,
          creditsUsed: Number.MAX_SAFE_INTEGER
        })),
        Effect.either
      )
    )

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain(
        'checkUsageCaps: creditsUsedAfter must be a non-negative integer <= Number.MAX_SAFE_INTEGER'
      )
    }
    expect(calls).toEqual(['getOrgCapState'])
  })

  it.each([
    ['incrementMonthlyUsage', async () => {
      const calls: Array<string> = []
      const outcome = await runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeUsageCapService
          return yield* service.incrementMonthlyUsage({
            organizationId: 'org-1',
            periodStart,
            periodEnd,
            deltaDecimillicents: Number.MAX_SAFE_INTEGER + 1,
            planTier: 'pro'
          })
        }).pipe(Effect.provide(makeStoreLayer(calls)), Effect.either)
      )
      return { calls, outcome }
    }, 'incrementMonthlyUsage: deltaDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER'],
    ['incrementMonthlyUsageAndEmit', async () => {
      const calls: Array<string> = []
      const outcome = await runEffectPromise(
        Effect.gen(function* () {
          const service = yield* makeUsageCapService
          return yield* service.incrementMonthlyUsageAndEmit({
            organizationId: 'org-1',
            periodStart,
            periodEnd,
            deltaDecimillicents: Number.MAX_SAFE_INTEGER + 1,
            planTier: 'pro'
          })
        }).pipe(Effect.provide(makeStoreLayer(calls)), Effect.either)
      )
      return { calls, outcome }
    }, 'incrementMonthlyUsageAndEmit: deltaDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER']
  ])('rejects unsafe deltas before calling %s store path', async (_label, run, message) => {
    const { calls, outcome } = await run()

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left.message).toContain(message)
    }
    expect(calls).toEqual([])
  })
})
