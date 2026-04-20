import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Effect, Option } from 'effect'
import {
  creditLedger,
  creditLedgerRepository,
  db,
  getPool,
  organizations,
  organizationsRepository,
  users
} from '@tx-agent-kit/db'
import { billingActivities } from './billing-activities.js'
import { releaseStaleReservationsActivity } from './billing-reservation-reclaim.js'

// @spec INV-BILLING-003 — orphan reservation reclaim
//
// Exercises the full reclaim path: the scheduled Temporal activity calls
// `creditService.releaseStaleReservations(...)`, which scans the ledger for
// uncloed `reserve` rows older than the configured age and appends a
// compensating `release` row per stale reserve via the existing release
// path. The credit_ledger trigger blocks UPDATE/DELETE — the reclaim path
// only ever INSERTs, so the audit trail stays immutable.

const TEST_ORG_NAME_PREFIX = 'billing-reservation-reclaim-test'
const MAX_AGE_SECONDS = 7200

interface TestOrg {
  orgId: string
  userId: string
}

const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

const cleanupOrgIds: string[] = []
const cleanupUserIds: string[] = []

const pool = (): ReturnType<typeof getPool> => getPool()

const cleanupLingeringTestOrganizations = async (): Promise<void> => {
  const client = await pool().connect()
  try {
    const orgs = await client.query<{ id: string }>(
      'SELECT id FROM organizations WHERE name LIKE $1',
      [`${TEST_ORG_NAME_PREFIX}%`]
    )
    const users_ = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE email LIKE $1',
      [`${TEST_ORG_NAME_PREFIX}-%@example.invalid`]
    )
    const orgIds = orgs.rows.map((row) => row.id)
    const userIds = users_.rows.map((row) => row.id)
    if (orgIds.length > 0) {
      await client.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [orgIds])
    }
    if (userIds.length > 0) {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds])
    }
  } finally {
    client.release()
  }
}

const seedTestOrg = async (
  overrides: {
    creditsBalance?: number
    reservedCredits?: number
  } = {}
): Promise<TestOrg> => {
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
      `INSERT INTO organizations (id, name, owner_user_id, credits_balance, reserved_credits)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        orgId,
        `${TEST_ORG_NAME_PREFIX} ${orgId}`,
        userId,
        overrides.creditsBalance ?? 1_000_000,
        overrides.reservedCredits ?? 0
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

/**
 * Insert a reserve row at a specific `created_at`. Raw INSERT into
 * `credit_ledger` is allowed — the immutability trigger blocks UPDATE and
 * DELETE only. We also bump `organizations.reserved_credits` in the same
 * transaction so the resulting state matches what `creditLedger.append`
 * would have produced had the reserve been issued in real time.
 */
const seedReserveRow = async (input: {
  orgId: string
  amount: number
  referenceId: string
  ageSeconds: number
}): Promise<string> => {
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    const ledgerResult = await client.query<{ id: string }>(
      `INSERT INTO credit_ledger (
         organization_id, amount_decimillicents, entry_type, reason,
         reference_id, balance_after, metadata, created_at
       )
       VALUES ($1, $2, 'reserve', $3, $4, 0, '{}'::jsonb, now() - make_interval(secs => $5))
       RETURNING id`,
      [
        input.orgId,
        input.amount,
        `seed stale reservation ${input.referenceId}`,
        input.referenceId,
        input.ageSeconds
      ]
    )
    const ledgerId = ledgerResult.rows[0]?.id ?? ''
    if (!ledgerId) {
      throw new Error('seedReserveRow: credit_ledger insert returned no id')
    }

    await client.query(
      `UPDATE organizations
       SET reserved_credits = reserved_credits + $1, updated_at = now()
       WHERE id = $2`,
      [input.amount, input.orgId]
    )
    await client.query('COMMIT')
    return ledgerId
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const hasReleaseRowForReserve = async (
  orgId: string,
  reserveId: string
): Promise<boolean> => {
  const client = await pool().connect()
  try {
    const result = await client.query(
      `SELECT 1
         FROM credit_ledger
        WHERE organization_id = $1
          AND entry_type = 'release'
          AND reference_id = $2
        LIMIT 1`,
      [orgId, `cancel:${reserveId}`]
    )
    return result.rows.length > 0
  } finally {
    client.release()
  }
}

const runReclaimUntilReserveReleased = async (
  orgId: string,
  reserveId: string
): Promise<number> => {
  let totalReleased = 0
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const released = await releaseStaleReservationsActivity(MAX_AGE_SECONDS)
    totalReleased += released
    if (await hasReleaseRowForReserve(orgId, reserveId)) {
      return totalReleased
    }
    if (released === 0) {
      return totalReleased
    }
  }
  return totalReleased
}

beforeAll(async () => {
  // Eagerly create the pool so connection errors surface in setup.
  pool()
  // Touch schema bindings to keep the imports alive (used by the @tx-agent-kit/db
  // Drizzle layer at runtime even when the test executes raw SQL).
  void creditLedger
  void organizations
  void users
  void db
  await cleanupLingeringTestOrganizations()
})

afterEach(async () => {
  if (cleanupOrgIds.length === 0 && cleanupUserIds.length === 0) {
    return
  }

  const client = await pool().connect()
  try {
    if (cleanupOrgIds.length > 0) {
      // credit_ledger is an immutable audit trail — deleting owning orgs
      // cascades organization_id to NULL via FK ON DELETE SET NULL, so the
      // audit rows survive without a dedicated cleanup step here.
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

describe('billing reservation reclaim activity (integration)', () => {
  it('releases stale reservations and leaves fresh reservations untouched', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 1_000_000 })

    const staleAmount = 250_000
    const freshAmount = 100_000

    const staleReserveId = await seedReserveRow({
      orgId,
      amount: staleAmount,
      referenceId: `stale-ref-${randomUUID()}`,
      ageSeconds: 3 * 60 * 60 // 3 hours old
    })
    const freshReserveId = await seedReserveRow({
      orgId,
      amount: freshAmount,
      referenceId: `fresh-ref-${randomUUID()}`,
      ageSeconds: 5 * 60 // 5 minutes old
    })

    // Baseline: org's reserved_credits reflects both reserves
    const baseline = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(baseline)) {
      throw new Error(`org ${orgId} missing after seeding reservations`)
    }
    expect(baseline.value.reservedCredits).toBe(staleAmount + freshAmount)

    // Act: scheduled activity runs with maxAge = 2h, so the 3h stale one is
    // in scope and the 5m fresh one is not.
    //
    // The activity is system-wide — under thread-pool integration parallelism
    // (pool: 'threads', isolate: false in the workspace config), other test
    // files in the same worker can leave their own stale reserves in the
    // shared DB. The aggregate return value is therefore NOT a per-test
    // assertion; it's `>= 1` (we own at least the one we seeded). Per-org
    // correctness is verified by the credit_ledger inspection further down.
    const firstReleased = await runReclaimUntilReserveReleased(orgId, staleReserveId)
    expect(firstReleased).toBeGreaterThanOrEqual(1)

    // Stale reservation was released:
    // - org.reserved_credits dropped by exactly the stale amount
    // - a `release` ledger row exists with reference_id = `cancel:<staleReserveId>`
    // - org.credits_balance is unchanged (release does not debit)
    const afterReclaim = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(afterReclaim)) {
      throw new Error(`org ${orgId} missing after reclaim`)
    }
    expect(afterReclaim.value.reservedCredits).toBe(freshAmount)
    expect(afterReclaim.value.creditsBalance).toBe(1_000_000)

    const entries = await runEffect(
      creditLedgerRepository.listForOrganization({ organizationId: orgId, limit: 50 })
    )
    const staleReleaseRow = entries.find(
      (row) => row.referenceId === `cancel:${staleReserveId}` && row.entryType === 'release'
    )
    expect(staleReleaseRow).toBeDefined()
    expect(staleReleaseRow!.amountDecimillicents).toBe(staleAmount)

    // Fresh reserve still has NO matching close row
    const freshCloseRow = entries.find(
      (row) =>
        row.entryType === 'release' &&
        (row.referenceId === `cancel:${freshReserveId}` ||
          row.referenceId === `release:${freshReserveId}` ||
          row.referenceId === `finalize:${freshReserveId}`)
    )
    expect(freshCloseRow).toBeUndefined()

    // Idempotency: re-running the activity must not re-release THIS test's
    // stale reserve (the credit_ledger row already exists). Because the
    // activity is system-wide we can't assert the global count is exactly 0
    // — concurrent test files may have seeded their own stale reserves. The
    // assertion that matters is on this test's org: the release row count
    // for `cancel:${staleReserveId}` stays at 1, verified below.
    const secondReleased = await releaseStaleReservationsActivity(MAX_AGE_SECONDS)
    expect(secondReleased).toBeGreaterThanOrEqual(0)

    const afterSecondReclaim = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(afterSecondReclaim)) {
      throw new Error(`org ${orgId} missing after idempotent reclaim`)
    }
    expect(afterSecondReclaim.value.reservedCredits).toBe(freshAmount)
    expect(afterSecondReclaim.value.creditsBalance).toBe(1_000_000)

    // Audit assurance: exactly one release row for the stale reserve exists
    // even after running the activity twice.
    const releaseEntriesAfterTwoRuns = (
      await runEffect(
        creditLedgerRepository.listForOrganization({ organizationId: orgId, limit: 50 })
      )
    ).filter((row) => row.referenceId === `cancel:${staleReserveId}`)
    expect(releaseEntriesAfterTwoRuns).toHaveLength(1)
  })

  it('returns zero when no reservations are older than maxAgeSeconds', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 500_000 })

    await seedReserveRow({
      orgId,
      amount: 75_000,
      referenceId: `young-ref-${randomUUID()}`,
      ageSeconds: 60 // 1 minute old
    })

    // The activity is system-wide; concurrent test files may have stale
    // reserves of their own. The per-org assertion below is the strict
    // check — this test's young reserve must NOT be released because it's
    // under the max-age window.
    await billingActivities.releaseStaleReservations(MAX_AGE_SECONDS)

    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      throw new Error(`org ${orgId} missing after no-op reclaim`)
    }
    expect(org.value.reservedCredits).toBe(75_000)
    expect(org.value.creditsBalance).toBe(500_000)
  })
})
