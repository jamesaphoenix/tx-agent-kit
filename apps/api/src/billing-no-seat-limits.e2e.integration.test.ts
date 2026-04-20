/**
 * Structural invariant test for the no-seat-limits rule.
 *
 * Every plan in the flat-rate storage-only pricing model permits unlimited
 * organization members. This test asserts:
 *
 *   1. The `org_members` table has no `seat_count` / `seat_limit` /
 *      `max_members` column.
 *   2. `PLAN_PRICE_CENTS`, `PLAN_STORAGE_LIMIT_BYTES`, and the contract
 *      `subscriptionPlans` record expose the numbers the spec requires
 *      (Try Me $19 / 10 GB, Pro $49 / 100 GB, Agency $199 / 500 GB).
 *   3. Hard ceilings are exactly 2× the included storage (20 GB / 200 GB /
 *      1 TB) via `PLAN_HARD_CEILING_BYTES`.
 *   4. Every plan's `featureLimits.teamMembers` is `null` (sentinel for
 *      unlimited).
 *   5. A batch insert of 100 org members into a single organization
 *      succeeds without any member count guard rejecting the inserts.
 *
 * @spec INV-BILLING-NO-SEAT-LIMITS
 * @spec billing-and-pricing-design §"Plans"
 */
import { randomUUID } from 'node:crypto'
import {
  PLAN_HARD_CEILING_BYTES,
  PLAN_PRICE_CENTS,
  PLAN_STORAGE_LIMIT_BYTES,
  subscriptionPlans
} from '@tx-agent-kit/contracts'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'api_no_seat_limits'
})

const GB = 1024 * 1024 * 1024

describe('no seat limits [INV-BILLING-NO-SEAT-LIMITS]', () => {
  it('org_members has no seat_count / seat_limit / max_members column', async () => {
    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const r = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'org_members'
            AND column_name IN ('seat_count', 'seat_limit', 'max_members', 'max_seats')`
      )
      expect(r.rows).toHaveLength(0)
    })
  })

  it('organizations has no seat_count / max_members column', async () => {
    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const r = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'organizations'
            AND column_name IN ('seat_count', 'seat_limit', 'max_members', 'max_seats')`
      )
      expect(r.rows).toHaveLength(0)
    })
  })

  it('every plan has teamMembers = null (unlimited)', () => {
    for (const plan of Object.values(subscriptionPlans)) {
      expect(plan.featureLimits.teamMembers).toBeNull()
    }
  })

  it('every plan has includedCreditsDecimillicents = 0 (no bundled credits)', () => {
    for (const plan of Object.values(subscriptionPlans)) {
      expect(plan.includedCreditsDecimillicents).toBe(0)
    }
  })

  it('PLAN_PRICE_CENTS matches the spec-declared flat-rate pricing', () => {
    expect(PLAN_PRICE_CENTS.try_me).toBe(1900) // $19
    expect(PLAN_PRICE_CENTS.pro).toBe(4900) // $49
    expect(PLAN_PRICE_CENTS.agency).toBe(19_900) // $199
  })

  it('PLAN_STORAGE_LIMIT_BYTES matches the spec-declared storage tiers', () => {
    expect(PLAN_STORAGE_LIMIT_BYTES.try_me).toBe(10 * GB)
    expect(PLAN_STORAGE_LIMIT_BYTES.pro).toBe(100 * GB)
    expect(PLAN_STORAGE_LIMIT_BYTES.agency).toBe(500 * GB)
  })

  it('PLAN_HARD_CEILING_BYTES matches the spec-declared hard ceilings', () => {
    expect(PLAN_HARD_CEILING_BYTES.try_me).toBe(20 * GB)
    expect(PLAN_HARD_CEILING_BYTES.pro).toBe(200 * GB)
    expect(PLAN_HARD_CEILING_BYTES.agency).toBe(1000 * GB)
  })

  it('hard ceilings are exactly 2× the included storage for every plan', () => {
    expect(PLAN_HARD_CEILING_BYTES.try_me).toBe(2 * PLAN_STORAGE_LIMIT_BYTES.try_me)
    expect(PLAN_HARD_CEILING_BYTES.pro).toBe(2 * PLAN_STORAGE_LIMIT_BYTES.pro)
    expect(PLAN_HARD_CEILING_BYTES.agency).toBe(2 * PLAN_STORAGE_LIMIT_BYTES.agency)
  })

  // The integration harness covers the app-level enforcement path. A pure
  // SQL INSERT batch sanity-checks the schema itself — if some trigger or
  // check constraint were added that caps members per org, this would
  // surface it immediately.
  it('100 org_members inserted into a single org all succeed (no seat guard)', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `nolimit-owner-${uid}@example.com`,
      password: 'no-seat-limits-pass-12345',
      name: 'NoSeatLimit Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'NoSeatLimit Org'
    })

    const BATCH_SIZE = 100
    await ctx.testContext.withSchemaClient(async (client) => {
      for (let i = 0; i < BATCH_SIZE; i += 1) {
        // Insert a synthetic user directly, then an org_members row pointing
        // at it. Going through the HTTP invitation flow for 100 users would
        // be excessively slow; the invariant under test is the SCHEMA, not
        // the invitation logic.
        const email = `nolimit-member-${uid}-${i}@example.com`
        const userRows = await client.query<{ id: string }>(
          `INSERT INTO users (email, name, password_hash)
           VALUES ($1, $2, 'synthetic-noop-hash')
           RETURNING id`,
          [email, `Member ${i}`]
        )
        const userId = userRows.rows[0]?.id
        if (!userId) {
          throw new Error(`Failed to insert synthetic user ${i}`)
        }

        await client.query(
          `INSERT INTO org_members (organization_id, user_id, role)
           VALUES ($1, $2, 'member')
           ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [org.id, userId]
        )
      }

      const countRow = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM org_members WHERE organization_id = $1`,
        [org.id]
      )
      // BATCH_SIZE members + the owner that createOrganization seeded.
      expect(Number(countRow.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(BATCH_SIZE)
    })
  })
})
