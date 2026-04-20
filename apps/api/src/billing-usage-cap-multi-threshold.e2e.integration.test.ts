/**
 * Multi-threshold crossing coverage for usage cap warnings.
 *
 * The atomic increment path (`incrementMonthlyUsageAndEmit`) emits at
 * most ONE event per call, choosing the highest threshold crossed
 * (exceeded > 95 > 80). Existing tests cover single-threshold crossings
 * one at a time. These tests pin the "highest wins" behavior when a
 * single increment jumps across multiple thresholds, and verify that
 * subsequent increments still emit the next threshold correctly.
 *
 * Rationale: an AI burst that jumps from 70 % to 96 % should NOT
 * silently skip both warnings — it must emit exactly one warning, and
 * the semantically-most-urgent one (95 %).
 *
 * @spec INV-BILLING-008 — atomic increment
 * @spec INV-BILLING-009 — transactional outbox emission
 * @spec REQ-BILLING-008 — threshold semantics
 */

import { UsageCapStorePortLive, makeUsageCapService } from '@tx-agent-kit/core'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_usage_cap_multi'
})

const periodStart = new Date(Date.UTC(2026, 0, 1))
const periodEnd = new Date(Date.UTC(2026, 1, 1))

interface DomainEventRow {
  event_type: string
  payload: { organizationId: string; percentUsed?: number; capDecimillicents: number }
}

const seedOrgAtUsage = async (
  ctx: ReturnType<typeof getFactoryContext>,
  cap: number,
  seededUsage: number
): Promise<{ orgId: string }> => {
  const owner = await createUser(ctx)
  const org = await createOrganization(ctx, { token: owner.token })
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET usage_cap = $1, updated_at = now() WHERE id = $2`,
      [cap, org.id]
    )
    await client.query(
      `INSERT INTO monthly_credits_usage (org_id, period_start, period_end, credits_used, plan_tier)
       VALUES ($1, $2, $3, $4, 'pro')`,
      [org.id, periodStart, periodEnd, seededUsage]
    )
  })
  return { orgId: org.id }
}

const incrementAndEmit = (orgId: string, delta: number) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* makeUsageCapService
      return yield* service.incrementMonthlyUsageAndEmit({
        organizationId: orgId,
        periodStart,
        periodEnd,
        deltaDecimillicents: delta,
        planTier: 'pro'
      })
    }).pipe(Effect.provide(UsageCapStorePortLive))
  )

const readWarnings = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string
): Promise<ReadonlyArray<DomainEventRow>> =>
  ctx.testContext.withSchemaClient(async (client) => {
    const result = await client.query<DomainEventRow>(
      `SELECT event_type, payload
         FROM domain_events
        WHERE aggregate_id = $1 AND event_type LIKE 'billing.usage_cap_%'
        ORDER BY occurred_at ASC, sequence_number ASC`,
      [orgId]
    )
    return result.rows
  })

describe('usage cap multi-threshold crossings', () => {
  // @spec REQ-BILLING-008
  it('emits only warning_95 when a single increment jumps past 80% and 95% in one step', async () => {
    const ctx = getFactoryContext()
    const { orgId } = await seedOrgAtUsage(ctx, 100_000, 70_000)

    // 70 % → 96 % in one increment. Crosses BOTH 80 and 95 thresholds.
    // Policy: highest threshold wins. Exactly one event, type warning_95.
    const result = await incrementAndEmit(orgId, 26_000)

    expect(result.emittedEventType).toBe('billing.usage_cap_warning')
    expect(result.previousCreditsUsed).toBe(70_000)
    expect(result.newCreditsUsed).toBe(96_000)

    const events = await readWarnings(ctx, orgId)
    expect(events).toHaveLength(1)
    expect(events[0]?.event_type).toBe('billing.usage_cap_warning')
    expect(events[0]?.payload.percentUsed).toBe(96)
  })

  // @spec REQ-BILLING-008
  it('emits only usage_cap_exceeded when a single increment jumps past 80%, 95%, and 100%', async () => {
    const ctx = getFactoryContext()
    const { orgId } = await seedOrgAtUsage(ctx, 100_000, 70_000)

    // 70 % → 110 %. Crosses 80, 95, AND 100 in one step.
    const result = await incrementAndEmit(orgId, 40_000)

    expect(result.emittedEventType).toBe('billing.usage_cap_exceeded')
    expect(result.newCreditsUsed).toBe(110_000)

    const events = await readWarnings(ctx, orgId)
    expect(events).toHaveLength(1)
    expect(events[0]?.event_type).toBe('billing.usage_cap_exceeded')
    // `exceeded` payload does not include percentUsed — it's implicit.
    expect(events[0]?.payload).toMatchObject({ organizationId: orgId, capDecimillicents: 100_000 })
  })

  // @spec REQ-BILLING-008
  it('emits warning_80 then warning_95 across two sequential increments', async () => {
    const ctx = getFactoryContext()
    const { orgId } = await seedOrgAtUsage(ctx, 100_000, 50_000)

    // Increment 1: 50 % → 85 % (crosses 80 only).
    const first = await incrementAndEmit(orgId, 35_000)
    expect(first.emittedEventType).toBe('billing.usage_cap_warning')
    expect(first.newCreditsUsed).toBe(85_000)

    // Increment 2: 85 % → 96 % (crosses 95 only — 80 is already past).
    const second = await incrementAndEmit(orgId, 11_000)
    expect(second.emittedEventType).toBe('billing.usage_cap_warning')
    expect(second.newCreditsUsed).toBe(96_000)

    const events = await readWarnings(ctx, orgId)
    expect(events).toHaveLength(2)
    expect(events[0]?.event_type).toBe('billing.usage_cap_warning')
    expect(events[0]?.payload.percentUsed).toBe(85)
    expect(events[1]?.event_type).toBe('billing.usage_cap_warning')
    expect(events[1]?.payload.percentUsed).toBe(96)
  })

  // @spec REQ-BILLING-008
  it('emits warning_80 then usage_cap_exceeded across two sequential increments', async () => {
    const ctx = getFactoryContext()
    const { orgId } = await seedOrgAtUsage(ctx, 100_000, 50_000)

    // Increment 1: 50 % → 82 % (crosses 80).
    await incrementAndEmit(orgId, 32_000)

    // Increment 2: 82 % → 103 % (crosses 95 AND 100 — highest wins, emit exceeded).
    const second = await incrementAndEmit(orgId, 21_000)
    expect(second.emittedEventType).toBe('billing.usage_cap_exceeded')
    expect(second.newCreditsUsed).toBe(103_000)

    const events = await readWarnings(ctx, orgId)
    expect(events).toHaveLength(2)
    expect(events[0]?.event_type).toBe('billing.usage_cap_warning')
    expect(events[1]?.event_type).toBe('billing.usage_cap_exceeded')
  })
})
