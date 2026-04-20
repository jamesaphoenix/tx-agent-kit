import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  db,
  getPool,
  organizations,
  users
} from '@tx-agent-kit/db'
import { reconcileMonthlyStorageOverageActivity } from './billing-storage-reconcile.js'

// Mirror of `PLAN_STORAGE_LIMIT_BYTES` from `@tx-agent-kit/contracts`.
// The worker package deliberately does not depend on @tx-agent-kit/contracts
// (Temporal workers pull their own runtime contracts from core), so we
// re-declare the numbers here. Keep in sync with `packages/contracts/src/plans.ts`.
const PLAN_STORAGE_LIMIT_BYTES = {
  try_me: 10 * 1024 * 1024 * 1024,
  pro: 100 * 1024 * 1024 * 1024,
  agency: 500 * 1024 * 1024 * 1024
} as const

/**
 * Integration test for the nightly storage reconciliation activity.
 *
 * Exercises the full flow: the activity lists every org whose
 * `storage_usage.period_end` has rolled over, then calls
 * `StorageBillingService.reconcileMonthlyOverage` per tenant. For orgs
 * with an overage, a negative `usage`/`storage_overage` ledger row is
 * appended. The service is idempotent via a `reconcile:<orgId>:<monthTag>`
 * reference_id so a second run of the same activity produces no further
 * ledger rows.
 *
 * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
 * @spec INV-BILLING-010 — billing consumers are idempotent.
 */

const TEST_ORG_NAME_PREFIX = 'billing-storage-reconcile-test'
const GB = 1024 * 1024 * 1024

const cleanupOrgIds: string[] = []
const cleanupUserIds: string[] = []

const pool = (): ReturnType<typeof getPool> => getPool()

const seedTestOrg = async (options: {
  plan: 'try_me' | 'pro' | 'agency'
  creditsBalance: number
  currentBytes: number
  periodDaysAgo: number
}): Promise<{ orgId: string; userId: string }> => {
  const userId = randomUUID()
  const orgId = randomUUID()

  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
      [
        userId,
        `${TEST_ORG_NAME_PREFIX}-${userId}@example.invalid`,
        'test-hash',
        `${TEST_ORG_NAME_PREFIX} user ${userId}`
      ]
    )
    await client.query(
      `INSERT INTO organizations (
         id, name, owner_user_id, credits_balance, reserved_credits,
         is_subscribed, subscription_status, subscription_plan
       )
       VALUES ($1, $2, $3, $4, 0, true, 'active', $5)`,
      [
        orgId,
        `${TEST_ORG_NAME_PREFIX} ${orgId}`,
        userId,
        options.creditsBalance,
        options.plan
      ]
    )

    // Seed a storage_usage row whose period_end is in the past — that is
    // what the activity's candidate query filters on.
    await client.query(
      `INSERT INTO storage_usage (
         org_id, period_start, period_end, current_bytes,
         plan_storage_limit, plan_tier
       )
       VALUES (
         $1,
         now() - make_interval(days => $2 + 30),
         now() - make_interval(days => $2),
         $3,
         $4,
         $5
       )`,
      [
        orgId,
        options.periodDaysAgo,
        options.currentBytes,
        PLAN_STORAGE_LIMIT_BYTES[options.plan],
        options.plan
      ]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  cleanupOrgIds.push(orgId)
  cleanupUserIds.push(userId)
  return { orgId, userId }
}

beforeAll(() => {
  pool()
  void organizations
  void users
  void db
})

afterEach(async () => {
  if (cleanupOrgIds.length === 0 && cleanupUserIds.length === 0) {
    return
  }
  const client = await pool().connect()
  try {
    if (cleanupOrgIds.length > 0) {
      await client.query(
        `DELETE FROM storage_usage WHERE org_id = ANY($1::uuid[])`,
        [cleanupOrgIds]
      )
      await client.query(
        `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
        [cleanupOrgIds]
      )
    }
    if (cleanupUserIds.length > 0) {
      await client.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[])`,
        [cleanupUserIds]
      )
    }
  } finally {
    client.release()
  }
  cleanupOrgIds.length = 0
  cleanupUserIds.length = 0
})

describe('nightly storage reconciliation activity (integration)', () => {
  // @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
  it('charges ongoing overage for orgs whose period has rolled over', async () => {
    // Try Me plan = 10 GB included. Seed 12 GB → 2 GB overage.
    const { orgId } = await seedTestOrg({
      plan: 'try_me',
      creditsBalance: 1_000_000_000, // plenty of credits
      currentBytes: 12 * GB,
      periodDaysAgo: 1
    })

    const outcome = await reconcileMonthlyStorageOverageActivity()

    expect(outcome.candidateCount).toBeGreaterThanOrEqual(1)
    expect(outcome.errorCount).toBe(0)

    const client = await pool().connect()
    try {
      const ledger = await client.query<{
        entry_type: string
        reason: string
        amount_decimillicents: string
      }>(
        `SELECT entry_type, reason, amount_decimillicents::text
           FROM credit_ledger
          WHERE organization_id = $1
            AND reason = 'storage_overage'`,
        [orgId]
      )
      expect(ledger.rows.length).toBeGreaterThanOrEqual(1)
      expect(ledger.rows[0]?.entry_type).toBe('usage')
      // Charge must be negative (debit).
      expect(Number(ledger.rows[0]?.amount_decimillicents)).toBeLessThan(0)
    } finally {
      client.release()
    }
  })

  // @spec INV-BILLING-010 — billing consumers are idempotent.
  it('is idempotent when run twice against the same period', async () => {
    const { orgId } = await seedTestOrg({
      plan: 'pro',
      creditsBalance: 10_000_000_000, // abundant
      currentBytes: PLAN_STORAGE_LIMIT_BYTES.pro + 5 * GB, // 5 GB overage
      periodDaysAgo: 2
    })

    await reconcileMonthlyStorageOverageActivity()
    await reconcileMonthlyStorageOverageActivity()

    const client = await pool().connect()
    try {
      const ledger = await client.query<{ id: string }>(
        `SELECT id FROM credit_ledger
          WHERE organization_id = $1
            AND reason = 'storage_overage'`,
        [orgId]
      )
      // Exactly one storage_overage row — the second run is a no-op via
      // the `reconcile:<orgId>:<monthTag>` reference_id idempotency guard.
      expect(ledger.rows).toHaveLength(1)
    } finally {
      client.release()
    }
  })

  it('skips orgs whose storage is within the plan allocation', async () => {
    // Seed at 50% of the Pro plan limit → no overage.
    const { orgId } = await seedTestOrg({
      plan: 'pro',
      creditsBalance: 1_000_000_000,
      currentBytes: PLAN_STORAGE_LIMIT_BYTES.pro / 2,
      periodDaysAgo: 1
    })

    const outcome = await reconcileMonthlyStorageOverageActivity()
    expect(outcome.errorCount).toBe(0)

    const client = await pool().connect()
    try {
      const ledger = await client.query<{ id: string }>(
        `SELECT id FROM credit_ledger
          WHERE organization_id = $1
            AND reason = 'storage_overage'`,
        [orgId]
      )
      expect(ledger.rows).toHaveLength(0)
    } finally {
      client.release()
    }
  })
})
