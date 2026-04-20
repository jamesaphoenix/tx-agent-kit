import { usageCapRepository } from '@tx-agent-kit/db'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Concurrency stress test for `usageCapRepository.incrementMonthlyUsage`.
 *
 * The repo uses a single-statement `INSERT … ON CONFLICT (org_id,
 * period_start) DO UPDATE SET credits_used = credits_used + delta` to
 * sidestep the lost-update class of bugs. This test fires N parallel
 * increments through `Promise.all` and asserts the persisted total is
 * EXACTLY `N * delta` — any race that reads-then-writes without the
 * row lock would lose updates and fail this assertion.
 *
 * The default N is high enough to push beyond the testkit DB pool's
 * `DB_POOL_MAX = 5` so parallel writers actually contend on the same row.
 *
 * @spec INV-BILLING-008 — monthly cap increment must be lost-update safe.
 */

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_usage_cap_concurrency'
})

const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

const PERIOD_START = new Date('2026-04-01T00:00:00Z')
const PERIOD_END = new Date('2026-05-01T00:00:00Z')

describe('usageCapRepository.incrementMonthlyUsage concurrency', () => {
  // @spec INV-BILLING-008
  it('100 parallel increments of 10 each produce credits_used = 1000 exactly', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const N = 100
    const DELTA = 10

    await Promise.all(
      Array.from({ length: N }, () =>
        runEffect(
          usageCapRepository.incrementMonthlyUsage({
            orgId: org.id,
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
            deltaDecimillicents: DELTA,
            planTier: null
          })
        )
      )
    )

    const total = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ credits_used: string }>(
        `SELECT credits_used::text
           FROM monthly_credits_usage
          WHERE org_id = $1 AND period_start = $2`,
        [org.id, PERIOD_START]
      )
      return Number.parseInt(result.rows[0]?.credits_used ?? '0', 10)
    })

    expect(total).toBe(N * DELTA)
  })

  // @spec INV-BILLING-008
  it('mixed-delta concurrent increments preserve the exact sum', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    // Distinct deltas sum to a unique total so a lost update would
    // produce a value that's also unique-but-wrong.
    const deltas = [3, 7, 11, 13, 17, 19, 23, 29, 31, 37]
    const expectedSum = deltas.reduce((a, b) => a + b, 0)

    await Promise.all(
      deltas.map((delta) =>
        runEffect(
          usageCapRepository.incrementMonthlyUsage({
            orgId: org.id,
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
            deltaDecimillicents: delta,
            planTier: null
          })
        )
      )
    )

    const total = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ credits_used: string }>(
        `SELECT credits_used::text
           FROM monthly_credits_usage
          WHERE org_id = $1 AND period_start = $2`,
        [org.id, PERIOD_START]
      )
      return Number.parseInt(result.rows[0]?.credits_used ?? '0', 10)
    })

    expect(total).toBe(expectedSum)
  })

  // @spec INV-BILLING-008
  it('two distinct orgs incremented in parallel never cross-contaminate', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const orgA = await createOrganization(ctx, { token: owner.token })
    const orgB = await createOrganization(ctx, { token: owner.token })

    const N_PER_ORG = 50
    const DELTA = 5

    const aWrites = Array.from({ length: N_PER_ORG }, () =>
      runEffect(
        usageCapRepository.incrementMonthlyUsage({
          orgId: orgA.id,
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          deltaDecimillicents: DELTA,
          planTier: null
        })
      )
    )
    const bWrites = Array.from({ length: N_PER_ORG }, () =>
      runEffect(
        usageCapRepository.incrementMonthlyUsage({
          orgId: orgB.id,
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          deltaDecimillicents: DELTA,
          planTier: null
        })
      )
    )

    await Promise.all([...aWrites, ...bWrites])

    const totals = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ org_id: string; credits_used: string }>(
        `SELECT org_id, credits_used::text
           FROM monthly_credits_usage
          WHERE org_id = ANY($1::uuid[]) AND period_start = $2
          ORDER BY org_id`,
        [[orgA.id, orgB.id], PERIOD_START]
      )
      return result.rows.map((row) => ({
        orgId: row.org_id,
        creditsUsed: Number.parseInt(row.credits_used, 10)
      }))
    })

    expect(totals).toHaveLength(2)
    expect(totals.find((t) => t.orgId === orgA.id)?.creditsUsed).toBe(N_PER_ORG * DELTA)
    expect(totals.find((t) => t.orgId === orgB.id)?.creditsUsed).toBe(N_PER_ORG * DELTA)
  })
})
