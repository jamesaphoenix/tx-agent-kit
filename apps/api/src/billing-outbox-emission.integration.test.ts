/**
 * Integration tests for transactional outbox emission from the billing
 * subsystem.
 *
 * @spec INV-BILLING-009 — domain events for threshold crossings must be
 *   inserted into `domain_events` within the same DB transaction as the
 *   credit mutation that triggers them.
 * @spec REQ-BILLING-008 — 80 % / 95 % / 100 % usage-cap events.
 */

import {
  UsageCapStorePortLive,
  makeUsageCapService
} from '@tx-agent-kit/core'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_outbox_emission'
})

const periodStart = new Date(Date.UTC(2026, 0, 1))
const periodEnd = new Date(Date.UTC(2026, 1, 1))

interface DomainEventRow {
  id: string
  event_type: string
  aggregate_type: string
  aggregate_id: string
  payload: Record<string, unknown>
  status: string
}

interface MonthlyUsageRow {
  credits_used: string
}

describe('billing outbox emission', () => {
  it('@spec INV-BILLING-009 @spec REQ-BILLING-008 emits billing.usage_cap_warning when increment crosses 80 percent', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await ctx.testContext.withSchemaClient(async (client) => {
      // Arrange: usage_cap = 100_000, credits_used seeded at 70_000.
      await client.query(
        `UPDATE organizations SET usage_cap = $1, updated_at = now() WHERE id = $2`,
        [100_000, org.id]
      )
      await client.query(
        `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.id, periodStart, periodEnd, 70_000, 'pro']
      )
    })

    // Act: 70k + 15k = 85k → 85 % (crosses the 80 % threshold).
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* makeUsageCapService
        return yield* service.incrementMonthlyUsageAndEmit({
          organizationId: org.id,
          periodStart,
          periodEnd,
          deltaDecimillicents: 15_000,
          planTier: 'pro'
        })
      }).pipe(Effect.provide(UsageCapStorePortLive))
    )

    expect(result.emittedEventType).toBe('billing.usage_cap_warning')
    expect(result.previousCreditsUsed).toBe(70_000)
    expect(result.newCreditsUsed).toBe(85_000)
    expect(result.capDecimillicents).toBe(100_000)

    // Assert: counter and outbox row were committed in the same tx.
    await ctx.testContext.withSchemaClient(async (client) => {
      const usage = await client.query<MonthlyUsageRow>(
        `SELECT credits_used FROM monthly_credits_usage WHERE org_id = $1 AND period_start = $2`,
        [org.id, periodStart]
      )
      expect(Number(usage.rows[0]?.credits_used)).toBe(85_000)

      const events = await client.query<DomainEventRow>(
        `SELECT id, event_type, aggregate_type, aggregate_id, payload, status
         FROM domain_events
         WHERE aggregate_id = $1 AND event_type LIKE 'billing.usage_cap_%'`,
        [org.id]
      )

      expect(events.rows).toHaveLength(1)
      const row = events.rows[0]
      if (!row) {
        throw new Error('missing outbox row')
      }
      expect(row.event_type).toBe('billing.usage_cap_warning')
      expect(row.aggregate_type).toBe('billing')
      expect(row.aggregate_id).toBe(org.id)
      expect(row.status).toBe('pending')
      expect(row.payload).toMatchObject({
        organizationId: org.id,
        capDecimillicents: 100_000,
        percentUsed: 85
      })
    })
  })

  it('@spec INV-BILLING-009 emits billing.usage_cap_warning when increment crosses 95 percent', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations SET usage_cap = $1, updated_at = now() WHERE id = $2`,
        [100_000, org.id]
      )
      await client.query(
        `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.id, periodStart, periodEnd, 90_000, 'pro']
      )
    })

    // 90k + 6k = 96k → 96 % (crosses 95, not 100).
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* makeUsageCapService
        return yield* service.incrementMonthlyUsageAndEmit({
          organizationId: org.id,
          periodStart,
          periodEnd,
          deltaDecimillicents: 6000,
          planTier: 'pro'
        })
      }).pipe(Effect.provide(UsageCapStorePortLive))
    )

    expect(result.emittedEventType).toBe('billing.usage_cap_warning')
    expect(result.newCreditsUsed).toBe(96_000)

    await ctx.testContext.withSchemaClient(async (client) => {
      const events = await client.query<DomainEventRow>(
        `SELECT event_type, payload FROM domain_events
         WHERE aggregate_id = $1 AND event_type LIKE 'billing.usage_cap_%'`,
        [org.id]
      )
      expect(events.rows).toHaveLength(1)
      const row = events.rows[0]
      if (!row) {
        throw new Error('missing outbox row')
      }
      expect(row.event_type).toBe('billing.usage_cap_warning')
      expect(row.payload).toMatchObject({ percentUsed: 96 })
    })
  })

  it('@spec INV-BILLING-009 emits billing.usage_cap_exceeded when increment crosses 100 percent', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations SET usage_cap = $1, updated_at = now() WHERE id = $2`,
        [100_000, org.id]
      )
      await client.query(
        `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.id, periodStart, periodEnd, 99_000, 'pro']
      )
    })

    // 99k + 5k = 104k → 104 % (crosses 100 — crossings DO increment; only
    // the pre-check via checkUsageCaps rejects before the debit).
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* makeUsageCapService
        return yield* service.incrementMonthlyUsageAndEmit({
          organizationId: org.id,
          periodStart,
          periodEnd,
          deltaDecimillicents: 5000,
          planTier: 'pro'
        })
      }).pipe(Effect.provide(UsageCapStorePortLive))
    )

    expect(result.emittedEventType).toBe('billing.usage_cap_exceeded')
    expect(result.newCreditsUsed).toBe(104_000)

    await ctx.testContext.withSchemaClient(async (client) => {
      const usage = await client.query<MonthlyUsageRow>(
        `SELECT credits_used FROM monthly_credits_usage WHERE org_id = $1 AND period_start = $2`,
        [org.id, periodStart]
      )
      expect(Number(usage.rows[0]?.credits_used)).toBe(104_000)

      const events = await client.query<DomainEventRow>(
        `SELECT event_type, aggregate_type, aggregate_id, payload
         FROM domain_events
         WHERE aggregate_id = $1 AND event_type LIKE 'billing.usage_cap_%'`,
        [org.id]
      )
      expect(events.rows).toHaveLength(1)
      const row = events.rows[0]
      if (!row) {
        throw new Error('missing outbox row')
      }
      expect(row.event_type).toBe('billing.usage_cap_exceeded')
      expect(row.aggregate_type).toBe('billing')
      expect(row.payload).toMatchObject({
        organizationId: org.id,
        capDecimillicents: 100_000
      })
    })
  })

  it('@spec INV-BILLING-009 does NOT emit an event when the increment stays below all thresholds', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations SET usage_cap = $1, updated_at = now() WHERE id = $2`,
        [100_000, org.id]
      )
      await client.query(
        `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.id, periodStart, periodEnd, 50_000, 'pro']
      )
    })

    // 50k + 20k = 70k → 70 %; no threshold crossed.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* makeUsageCapService
        return yield* service.incrementMonthlyUsageAndEmit({
          organizationId: org.id,
          periodStart,
          periodEnd,
          deltaDecimillicents: 20_000,
          planTier: 'pro'
        })
      }).pipe(Effect.provide(UsageCapStorePortLive))
    )

    expect(result.emittedEventType).toBeNull()
    expect(result.newCreditsUsed).toBe(70_000)

    await ctx.testContext.withSchemaClient(async (client) => {
      const events = await client.query(
        `SELECT event_type FROM domain_events
         WHERE aggregate_id = $1 AND event_type LIKE 'billing.%'`,
        [org.id]
      )
      expect(events.rows).toHaveLength(0)
    })
  })

  it('@spec INV-BILLING-009 does NOT re-emit a warning when the threshold was already crossed on a previous increment', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await ctx.testContext.withSchemaClient(async (client) => {
      // Seed so previous usage is already past 80 %.
      await client.query(
        `UPDATE organizations SET usage_cap = $1, updated_at = now() WHERE id = $2`,
        [100_000, org.id]
      )
      await client.query(
        `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.id, periodStart, periodEnd, 85_000, 'pro']
      )
    })

    // 85k + 5k = 90k → still in the 80-95 band, no NEW crossing.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* makeUsageCapService
        return yield* service.incrementMonthlyUsageAndEmit({
          organizationId: org.id,
          periodStart,
          periodEnd,
          deltaDecimillicents: 5000,
          planTier: 'pro'
        })
      }).pipe(Effect.provide(UsageCapStorePortLive))
    )

    expect(result.emittedEventType).toBeNull()
    expect(result.newCreditsUsed).toBe(90_000)

    await ctx.testContext.withSchemaClient(async (client) => {
      const events = await client.query(
        `SELECT event_type FROM domain_events
         WHERE aggregate_id = $1 AND event_type LIKE 'billing.%'`,
        [org.id]
      )
      expect(events.rows).toHaveLength(0)
    })
  })

  it('@spec INV-BILLING-009 checkUsageCaps rejection commits a usage_cap_exceeded event even though no counter mutation happens', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations SET usage_cap = $1, updated_at = now() WHERE id = $2`,
        [100_000, org.id]
      )
      await client.query(
        `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.id, periodStart, periodEnd, 99_000, 'pro']
      )
    })

    // 99k + 2k = 101k → checkUsageCaps must reject and emit the event.
    const either = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* makeUsageCapService
        return yield* service.checkUsageCaps({
          organizationId: org.id,
          estimatedCostDecimillicents: 2000,
          periodStart,
          periodEnd,
          planTier: 'pro'
        })
      }).pipe(Effect.provide(UsageCapStorePortLive), Effect.either)
    )

    expect(either._tag).toBe('Left')

    await ctx.testContext.withSchemaClient(async (client) => {
      const usage = await client.query<MonthlyUsageRow>(
        `SELECT credits_used FROM monthly_credits_usage WHERE org_id = $1 AND period_start = $2`,
        [org.id, periodStart]
      )
      // Counter unchanged — pre-check rejected BEFORE the debit path.
      expect(Number(usage.rows[0]?.credits_used)).toBe(99_000)

      const events = await client.query<DomainEventRow>(
        `SELECT event_type, aggregate_type, aggregate_id, payload
         FROM domain_events
         WHERE aggregate_id = $1 AND event_type = 'billing.usage_cap_exceeded'`,
        [org.id]
      )
      expect(events.rows).toHaveLength(1)
      const row = events.rows[0]
      if (!row) {
        throw new Error('missing outbox row')
      }
      expect(row.aggregate_type).toBe('billing')
      expect(row.payload).toMatchObject({
        organizationId: org.id,
        capDecimillicents: 100_000
      })
    })
  })

  it('@spec INV-BILLING-009 does not emit a warning when usage_cap is null (uncapped)', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    // Org created with usage_cap defaulting to null — seed a large existing usage.
    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.id, periodStart, periodEnd, 1_000_000, 'pro']
      )
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* makeUsageCapService
        return yield* service.incrementMonthlyUsageAndEmit({
          organizationId: org.id,
          periodStart,
          periodEnd,
          deltaDecimillicents: 500_000,
          planTier: 'pro'
        })
      }).pipe(Effect.provide(UsageCapStorePortLive))
    )

    expect(result.emittedEventType).toBeNull()
    expect(result.capDecimillicents).toBeNull()
    expect(result.newCreditsUsed).toBe(1_500_000)

    await ctx.testContext.withSchemaClient(async (client) => {
      const events = await client.query(
        `SELECT event_type FROM domain_events
         WHERE aggregate_id = $1 AND event_type LIKE 'billing.%'`,
        [org.id]
      )
      expect(events.rows).toHaveLength(0)
    })
  })

})
