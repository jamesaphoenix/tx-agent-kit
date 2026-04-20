import {
  AutoRechargeAttemptStorePortLive,
  BillingGuardDisabledPortLive,
  BillingService,
  BillingServiceLive,
  BillingStorePortLive,
  ClockPortLive,
  CreditLedgerStorePortLive,
  ProcessedStripeEventStorePortLive,
  StripePort,
  SubscriptionEventStorePortLive,
  UsageStorePortLive,
  type BillingGuardPort,
  type BillingStorePort,
  type ClockPort,
  type CoreError,
  type UsageStorePort
} from '@tx-agent-kit/core'
import {
  createCostResult,
  createCostResultFromOpenRouterUsage,
  DEFAULT_MARGIN_MULTIPLIER
} from '@tx-agent-kit/contracts'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { Effect, Either, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * End-to-end test for `BillingService.recordUsageFromCostResult`.
 *
 * The new helper takes a {@link CostResult} (the OpenRouter-derived
 * priced operation object) and writes a `usage_records` row that mirrors
 * the per-operation breakdown. This test asserts the full path against
 * a real Postgres schema:
 *
 *   1. Create a CostResult (matching what an OpenRouter response would
 *      produce for a text generation call).
 *   2. Call `recordUsageFromCostResult` through a fully wired
 *      BillingService runtime.
 *   3. Assert the row in `usage_records` carries the right
 *      `unit_cost_decimillicents`, `total_cost_decimillicents`,
 *      `quantity = 1`, and that the breakdown is preserved in
 *      `metadata.cost`.
 *
 * Stripe remains stubbed here because usage deduction is accounted for in the
 * local credit ledger, not Stripe metered subscription items.
 *
 * @spec billing-and-pricing-design §"Cost recording"
 * @spec INV-BILLING-006 — margin is applied at CostResult creation time.
 * @spec INV-BILLING-008 — usage records drive the monthly cap increment.
 */

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_record_usage_cost_result'
})

const StubStripePortLive = Layer.succeed(StripePort, {
  createCheckoutSession: () => Effect.fail(new Error('not used in this test')),
  createPortalSession: () => Effect.fail(new Error('not used in this test')),
  createTopUpSession: () => Effect.fail(new Error('not used in this test')),
  constructWebhookEvent: () => Effect.fail(new Error('not used in this test')),
  createCustomer: () => Effect.fail(new Error('not used in this test')),
  createOffSessionPaymentIntent: () =>
    Effect.fail(new Error('not used in this test')),
  resolvePlanFromPriceIds: () => 'pro' as const
})

const ServiceDeps = Layer.mergeAll(
  BillingServiceLive,
  BillingStorePortLive,
  UsageStorePortLive,
  CreditLedgerStorePortLive,
  AutoRechargeAttemptStorePortLive,
  ProcessedStripeEventStorePortLive,
  SubscriptionEventStorePortLive,
  BillingGuardDisabledPortLive,
  ClockPortLive,
  StubStripePortLive
)

type BillingServiceImpl = Effect.Effect.Success<typeof BillingService>

/**
 * The BillingService method signatures retain their port deps in the
 * `R` channel (BillingStorePort, UsageStorePort, StripePort,
 * BillingGuardPort, ClockPort). The caller's program inherits those
 * deps; `ServiceDeps` provides every one of them so the final Effect
 * is dependency-free.
 */
type BillingProgramR =
  | BillingStorePort
  | UsageStorePort
  | StripePort
  | BillingGuardPort
  | ClockPort

const runWithService = async <A>(
  program: (svc: BillingServiceImpl) => Effect.Effect<A, CoreError, BillingProgramR>
): Promise<Either.Either<A, CoreError>> => {
  const effect = Effect.gen(function* () {
    const svc = yield* BillingService
    return yield* program(svc)
  }).pipe(Effect.provide(ServiceDeps), Effect.either)
  return Effect.runPromise(effect)
}

describe('recordUsageFromCostResult integration', () => {
  // @spec billing-and-pricing-design §"Cost recording"
  it('writes a usage_records row with marginCostInCreditsDecimillicents as unit cost', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    // 0.02 USD = 200 decimillicents (1 dollar = 10_000 decimillicents).
    // With the default 1.10x margin → 220 decimillicents.
    const cost = createCostResult('ai.text_generation.gpt-5', 200)
    expect(cost.marginCostInCreditsDecimillicents).toBe(220)

    const referenceId = `cost-result-test-${org.id}`
    const outcome = await runWithService((svc) =>
      svc.recordUsageFromCostResult({
        organizationId: org.id,
        category: 'text_generation',
        cost,
        referenceId,
        metadata: { traceId: 'trace-abc' }
      })
    )

    expect(Either.isRight(outcome)).toBe(true)
    if (Either.isRight(outcome)) {
      expect(outcome.right.organizationId).toBe(org.id)
      expect(outcome.right.quantity).toBe(1)
      expect(outcome.right.unitCostDecimillicents).toBe(220)
      expect(outcome.right.totalCostDecimillicents).toBe(220)
      expect(outcome.right.referenceId).toBe(referenceId)
    }

    // Verify the row is persisted with the expected breakdown in metadata.
    const row = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{
        quantity: string
        unit_cost_decimillicents: string
        total_cost_decimillicents: string
        category: string
        metadata: Record<string, unknown>
      }>(
        `SELECT quantity::text, unit_cost_decimillicents::text,
                total_cost_decimillicents::text, category, metadata
           FROM usage_records
          WHERE organization_id = $1 AND reference_id = $2`,
        [org.id, referenceId]
      )
      return result.rows[0] ?? null
    })
    expect(row).not.toBeNull()
    if (row) {
      expect(Number.parseInt(row.quantity, 10)).toBe(1)
      expect(Number.parseInt(row.unit_cost_decimillicents, 10)).toBe(220)
      expect(Number.parseInt(row.total_cost_decimillicents, 10)).toBe(220)
      expect(row.category).toBe('text_generation')
      // The CostResult breakdown is preserved in metadata.cost
      const metadata = row.metadata
      expect(metadata).toMatchObject({
        traceId: 'trace-abc',
        cost: {
          name: 'ai.text_generation.gpt-5',
          costInCreditsDecimillicents: 200,
          marginCostInCreditsDecimillicents: 220
        }
      })
    }
  })

  // @spec billing-and-pricing-design §"Cost recording"
  // @spec INV-BILLING-006 — margin is applied at CostResult creation time.
  it('drives totalCost from CostResult.marginCostInCreditsDecimillicents (1.10x of base)', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    // 1_000_000 decimillicents base = $100 → 1_100_000 with default margin
    const cost = createCostResult('ai.image_generation.gpt-image-1', 1_000_000)
    expect(cost.marginCostInCreditsDecimillicents).toBe(1_100_000)

    const outcome = await runWithService((svc) =>
      svc.recordUsageFromCostResult({
        organizationId: org.id,
        category: 'image_generation',
        cost,
        referenceId: `image-${org.id}`
      })
    )

    expect(Either.isRight(outcome)).toBe(true)
    if (Either.isRight(outcome)) {
      // The ledger MUST NOT re-apply margin — 1_100_000 in, 1_100_000 out.
      expect(outcome.right.unitCostDecimillicents).toBe(1_100_000)
      expect(outcome.right.totalCostDecimillicents).toBe(1_100_000)
    }
  })

  // @spec billing-and-pricing-design §"Cost recording"
  // @spec INV-BILLING-010 — billing consumers are idempotent.
  it('is idempotent on the same referenceId — second call returns the existing row', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const cost = createCostResult('ai.text_generation.gpt-5', 500)
    const referenceId = `idempotent-${org.id}`

    const first = await runWithService((svc) =>
      svc.recordUsageFromCostResult({
        organizationId: org.id,
        category: 'text_generation',
        cost,
        referenceId
      })
    )
    const second = await runWithService((svc) =>
      svc.recordUsageFromCostResult({
        organizationId: org.id,
        category: 'text_generation',
        cost,
        referenceId
      })
    )

    expect(Either.isRight(first)).toBe(true)
    expect(Either.isRight(second)).toBe(true)
    if (Either.isRight(first) && Either.isRight(second)) {
      expect(second.right.id).toBe(first.right.id)
    }

    const rowCount = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM usage_records
          WHERE organization_id = $1 AND reference_id = $2`,
        [org.id, referenceId]
      )
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(rowCount).toBe(1)
  })

  // @spec billing-and-pricing-design §"Cost recording"
  it('also accepts a CostResult derived from an OpenRouter response', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    // Synthetic OpenRouter response — duck-typed to OpenRouterUsageLike.
    const openRouterResponse = {
      model: 'openai/gpt-4o-mini',
      usage: { cost: 0.0123 } // $0.0123
    }
    const cost = createCostResultFromOpenRouterUsage(openRouterResponse, 'text_generation')

    // 0.0123 * 10_000_000 (decimillicents/dollar) = 123_000 base
    // 1.10x → ceil(123_000 * 11_000 / 10_000) = 135_300
    expect(cost.name).toBe('ai.text_generation.openai/gpt-4o-mini')
    expect(cost.costInCreditsDecimillicents).toBe(123_000)
    expect(cost.marginCostInCreditsDecimillicents).toBe(
      Math.ceil((123_000 * Math.round(DEFAULT_MARGIN_MULTIPLIER * 10_000)) / 10_000)
    )

    const outcome = await runWithService((svc) =>
      svc.recordUsageFromCostResult({
        organizationId: org.id,
        category: 'text_generation',
        cost,
        referenceId: `openrouter-${org.id}`
      })
    )

    expect(Either.isRight(outcome)).toBe(true)
    if (Either.isRight(outcome)) {
      expect(outcome.right.unitCostDecimillicents).toBe(cost.marginCostInCreditsDecimillicents)
    }
  })

  // Defensive bounds: the public schema pins these, but the core
  // service is also reachable via `recordUsageFromCostResult` and any
  // future in-process caller. NaN / Infinity / non-integers / negative
  // / overflow must all be rejected at the service seam before any DB
  // row or Stripe meter call is made.
  describe('recordUsage bounds', () => {
    it('rejects NaN quantity', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })

      const outcome = await runWithService((svc) =>
        svc.recordUsage({
          organizationId: org.id,
          category: 'text_generation',
          quantity: Number.NaN,
          unitCostDecimillicents: 100,
          referenceId: `nan-qty-${org.id}`,
          metadata: {}
        })
      )
      expect(Either.isLeft(outcome)).toBe(true)
    })

    it('rejects Infinity unit cost', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })

      const outcome = await runWithService((svc) =>
        svc.recordUsage({
          organizationId: org.id,
          category: 'text_generation',
          quantity: 1,
          unitCostDecimillicents: Number.POSITIVE_INFINITY,
          referenceId: `inf-unit-${org.id}`,
          metadata: {}
        })
      )
      expect(Either.isLeft(outcome)).toBe(true)
    })

    it('rejects non-integer quantity', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })

      const outcome = await runWithService((svc) =>
        svc.recordUsage({
          organizationId: org.id,
          category: 'text_generation',
          quantity: 1.5,
          unitCostDecimillicents: 100,
          referenceId: `frac-qty-${org.id}`,
          metadata: {}
        })
      )
      expect(Either.isLeft(outcome)).toBe(true)
    })

    it('rejects unsafe quantity even when the unit cost is zero', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })

      const outcome = await runWithService((svc) =>
        svc.recordUsage({
          organizationId: org.id,
          category: 'text_generation',
          quantity: Number.MAX_SAFE_INTEGER + 1,
          unitCostDecimillicents: 0,
          referenceId: `unsafe-qty-${org.id}`,
          metadata: {}
        })
      )
      expect(Either.isLeft(outcome)).toBe(true)
      if (Either.isLeft(outcome)) {
        expect(outcome.left.message).toContain('quantity must be a positive integer')
      }

      const rowCount = await ctx.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM usage_records WHERE organization_id = $1`,
          [org.id]
        )
        return Number.parseInt(result.rows[0]?.count ?? '0', 10)
      })
      expect(rowCount).toBe(0)
    })

    it('rejects negative unit cost', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })

      const outcome = await runWithService((svc) =>
        svc.recordUsage({
          organizationId: org.id,
          category: 'text_generation',
          quantity: 1,
          unitCostDecimillicents: -100,
          referenceId: `neg-unit-${org.id}`,
          metadata: {}
        })
      )
      expect(Either.isLeft(outcome)).toBe(true)
    })

    it('rejects unsafe unit cost at the service seam', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })

      const outcome = await runWithService((svc) =>
        svc.recordUsage({
          organizationId: org.id,
          category: 'text_generation',
          quantity: 1,
          unitCostDecimillicents: Number.MAX_SAFE_INTEGER + 1,
          referenceId: `unsafe-unit-${org.id}`,
          metadata: {}
        })
      )
      expect(Either.isLeft(outcome)).toBe(true)
      if (Either.isLeft(outcome)) {
        expect(outcome.left.message).toContain('unitCostDecimillicents must be a non-negative integer')
      }
    })

    // Overflow guard: Number.MAX_SAFE_INTEGER is 9_007_199_254_740_991.
    // A quantity of 10^9 and a unit cost of 10^9 multiply to 10^18,
    // which exceeds MAX_SAFE_INTEGER and would silently round as a
    // plain-Number multiplication. The BigInt overflow check must
    // reject this before the row is written to usage_records.
    it('rejects quantity * unitCost overflow beyond MAX_SAFE_INTEGER', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })

      const outcome = await runWithService((svc) =>
        svc.recordUsage({
          organizationId: org.id,
          category: 'text_generation',
          quantity: 1_000_000_000,
          unitCostDecimillicents: 1_000_000_000,
          referenceId: `overflow-${org.id}`,
          metadata: {}
        })
      )
      expect(Either.isLeft(outcome)).toBe(true)

      const rowCount = await ctx.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM usage_records WHERE organization_id = $1`,
          [org.id]
        )
        return Number.parseInt(result.rows[0]?.count ?? '0', 10)
      })
      expect(rowCount).toBe(0)
    })
  })
})
