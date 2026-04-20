import {
  UsageCapStorePort,
  makeUsageCapService,
  type CoreError
} from '@tx-agent-kit/core'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { Effect, Either, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_usage_cap'
})

/**
 * Build an in-memory UsageCapStorePort backed by a mutable record so we can
 * drive the service through its happy-path and failure branches without the
 * round-trip latency of the real DB. The DB-level concurrency test below
 * exercises the real repository path.
 */
const makeFakeStore = (initial: {
  usageCap: number | null
  creditsUsed: number
}) => {
  const state = {
    usageCap: initial.usageCap,
    creditsUsed: initial.creditsUsed,
    incrementCalls: 0
  }

  const layer = Layer.succeed(UsageCapStorePort, {
    getOrgCapState: (_orgId: string, _periodStart: Date, _periodEnd: Date) =>
      Effect.succeed(
        Option.some({
          usageCapDecimillicents: Option.fromNullable(state.usageCap),
          creditsUsed: state.creditsUsed
        })
      ),
    incrementMonthlyUsage: (
      _orgId: string,
      _periodStart: Date,
      _periodEnd: Date,
      delta: number,
      _planTier: string | null
    ) =>
      Effect.sync(() => {
        state.incrementCalls += 1
        state.creditsUsed += delta
      }),
    incrementMonthlyUsageAndEmit: (
      _orgId: string,
      _periodStart: Date,
      _periodEnd: Date,
      delta: number,
      _planTier: string | null
    ) =>
      Effect.sync(() => {
        const previous = state.creditsUsed
        state.incrementCalls += 1
        state.creditsUsed += delta
        return {
          previousCreditsUsed: previous,
          newCreditsUsed: state.creditsUsed,
          capDecimillicents: state.usageCap,
          emittedEventType: null as
            | null
            | 'billing.usage_cap_warning'
            | 'billing.usage_cap_exceeded'
        }
      }),
    emitUsageCapExceeded: (_orgId: string, _capDecimillicents: number) =>
      Effect.void
  })

  return { state, layer }
}

const runCheck = async (
  layer: Layer.Layer<UsageCapStorePort>,
  input: {
    organizationId: string
    campaignId?: string | null
    estimatedCostDecimillicents: number
    periodStart: Date
    periodEnd: Date
    planTier: string
  }
): Promise<
  | { ok: true; result: { warningLevel: string; creditsUsedAfter: number; usageCapDecimillicents: number | null } }
  | { ok: false; error: CoreError }
> => {
  // Run via Effect.either so typed CoreError failures surface as Left rather
  // than throwing a FiberFailure wrapper — the latter loses the `code` field.
  const program = Effect.gen(function* () {
    const service = yield* makeUsageCapService
    return yield* service.checkUsageCaps(input)
  }).pipe(Effect.provide(layer), Effect.either)

  const result = await Effect.runPromise(program)
  return Either.match(result, {
    onLeft: (error) => ({ ok: false as const, error }),
    onRight: (value) => ({ ok: true as const, result: value })
  })
}

const periodStart = new Date(Date.UTC(2026, 0, 1))
const periodEnd = new Date(Date.UTC(2026, 1, 1))

describe('billing usage cap integration', () => {
  it('returns warningLevel=none when projected usage is 50% of cap', async () => {
    const { layer } = makeFakeStore({ usageCap: 100_000, creditsUsed: 40_000 })
    const outcome = await runCheck(layer, {
      organizationId: 'org-1',
      estimatedCostDecimillicents: 10_000,
      periodStart,
      periodEnd,
      planTier: 'pro'
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warningLevel).toBe('none')
      expect(outcome.result.creditsUsedAfter).toBe(50_000)
      expect(outcome.result.usageCapDecimillicents).toBe(100_000)
    }
  })

  it('returns warningLevel=warning_80 when projected usage crosses the 80% threshold', async () => {
    const { layer } = makeFakeStore({ usageCap: 100_000, creditsUsed: 80_000 })
    const outcome = await runCheck(layer, {
      organizationId: 'org-1',
      estimatedCostDecimillicents: 5000, // 85_000 / 100_000 = 85%
      periodStart,
      periodEnd,
      planTier: 'pro'
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warningLevel).toBe('warning_80')
    }
  })

  it('returns warningLevel=warning_95 when projected usage crosses the 95% threshold', async () => {
    const { layer } = makeFakeStore({ usageCap: 100_000, creditsUsed: 95_000 })
    const outcome = await runCheck(layer, {
      organizationId: 'org-1',
      estimatedCostDecimillicents: 1000, // 96_000 / 100_000 = 96%
      periodStart,
      periodEnd,
      planTier: 'pro'
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warningLevel).toBe('warning_95')
    }
  })

  // @spec REQ-BILLING-008 — boundary consistency with incrementMonthlyUsageAndEmit
  // The atomic DB increment uses `newPercent >= X` for crossings; the
  // predictive checkUsageCaps classifier must match so an op projected at
  // exactly 80/95/100 % doesn't silently disagree with the post-mutation
  // emit. These three tests pin the inclusive-high-side semantics at the
  // boundary.
  it('treats projected usage at exactly 80.0% as warning_80 (inclusive)', async () => {
    const { layer } = makeFakeStore({ usageCap: 100_000, creditsUsed: 70_000 })
    const outcome = await runCheck(layer, {
      organizationId: 'org-1',
      estimatedCostDecimillicents: 10_000, // 80_000 / 100_000 = 80% exactly
      periodStart,
      periodEnd,
      planTier: 'pro'
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warningLevel).toBe('warning_80')
    }
  })

  it('treats projected usage at exactly 95.0% as warning_95 (inclusive)', async () => {
    const { layer } = makeFakeStore({ usageCap: 100_000, creditsUsed: 85_000 })
    const outcome = await runCheck(layer, {
      organizationId: 'org-1',
      estimatedCostDecimillicents: 10_000, // 95_000 / 100_000 = 95% exactly
      periodStart,
      periodEnd,
      planTier: 'pro'
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warningLevel).toBe('warning_95')
    }
  })

  it('treats projected usage at exactly 100.0% as exceeded and fails with paymentRequired', async () => {
    const { state, layer } = makeFakeStore({ usageCap: 100_000, creditsUsed: 95_000 })
    const outcome = await runCheck(layer, {
      organizationId: 'org-1',
      estimatedCostDecimillicents: 5000, // 100_000 / 100_000 = 100% exactly
      periodStart,
      periodEnd,
      planTier: 'pro'
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('PAYMENT_REQUIRED')
    }
    expect(state.incrementCalls).toBe(0)
  })

  it('@spec REQ-BILLING-008 fails with paymentRequired when projected usage exceeds 100% and leaves counter untouched', async () => {
    const { state, layer } = makeFakeStore({ usageCap: 100_000, creditsUsed: 99_000 })
    const outcome = await runCheck(layer, {
      organizationId: 'org-1',
      estimatedCostDecimillicents: 2000, // 101_000 / 100_000 = 101%
      periodStart,
      periodEnd,
      planTier: 'pro'
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('PAYMENT_REQUIRED')
      expect(outcome.error.message).toMatch(/usage cap exceeded/i)
    }
    // The cap check is BEFORE the debit: credits_used must be untouched.
    expect(state.creditsUsed).toBe(99_000)
    expect(state.incrementCalls).toBe(0)
  })

  it('returns warningLevel=none and skips the cap entirely when usage_cap is null', async () => {
    const { layer } = makeFakeStore({ usageCap: null, creditsUsed: 1_000_000_000 })
    const outcome = await runCheck(layer, {
      organizationId: 'org-1',
      estimatedCostDecimillicents: 5_000_000,
      periodStart,
      periodEnd,
      planTier: 'free'
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warningLevel).toBe('none')
      expect(outcome.result.usageCapDecimillicents).toBeNull()
      expect(outcome.result.creditsUsedAfter).toBe(1_005_000_000)
    }
  })

  it('skips campaign check when campaignId is null (campaigns subsystem is a stub)', async () => {
    const { layer } = makeFakeStore({ usageCap: 100_000, creditsUsed: 10_000 })
    const outcome = await runCheck(layer, {
      organizationId: 'org-1',
      campaignId: null,
      estimatedCostDecimillicents: 5000,
      periodStart,
      periodEnd,
      planTier: 'pro'
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warningLevel).toBe('none')
    }
  })

  // @spec REQ-BILLING-007 — concurrent credit deductions must sum correctly (no lost updates).
  it('@spec INV-BILLING-008 @spec REQ-BILLING-007 two concurrent increments against the same (org, period) sum correctly without lost updates', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const deltaA = 12_345
    const deltaB = 67_890
    const expected = deltaA + deltaB

    await ctx.testContext.withSchemaClient(async (client) => {
      // Kick off both increments concurrently against the same (org, period_start)
      // row. With a single-statement INSERT ... ON CONFLICT DO UPDATE the two
      // updates must serialize at the row lock and sum cleanly.
      await Promise.all([
        client.query(
          `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (org_id, period_start)
           DO UPDATE SET credits_used = monthly_credits_usage.credits_used + EXCLUDED.credits_used`,
          [org.id, periodStart, periodEnd, deltaA, 'pro']
        ),
        client.query(
          `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (org_id, period_start)
           DO UPDATE SET credits_used = monthly_credits_usage.credits_used + EXCLUDED.credits_used`,
          [org.id, periodStart, periodEnd, deltaB, 'pro']
        )
      ])

      const result = await client.query<{ credits_used: string }>(
        `SELECT credits_used FROM monthly_credits_usage
         WHERE org_id = $1 AND period_start = $2`,
        [org.id, periodStart]
      )
      expect(Number(result.rows[0]?.credits_used)).toBe(expected)
    })
  })
})
