import {
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  makeCreditService,
  type CoreError
} from '@tx-agent-kit/core'
import { creditLedgerRepository } from '@tx-agent-kit/db'
import {
  createOrganization,
  createUser,
  expectAllRight,
  seedOrgCredits
} from '@tx-agent-kit/testkit'
import { Effect, Either, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Stress test for the `releaseStaleReservations` reclaim path against
 * a concurrent `finalize` or `release` on the same reservation id.
 *
 * The reclaim design:
 *   1. SELECT every `entry_type = 'reserve'` row older than `olderThan`
 *      where NO close row exists (cancel/release/finalize).
 *   2. For each row, append `cancel:<reserve_id>` — which takes an
 *      `organizations FOR UPDATE` lock inside `creditLedgerStore.append`
 *      and decrements `reserved_credits`.
 *
 * The race I'm hunting for: scan runs at T0 and finds reserve R. Between
 * T0 and T1, a concurrent `finalize` or `release` on R commits and
 * writes `release:R` + `finalize:R` rows (decrementing reserved_credits).
 * At T1, the reclaim appends `cancel:R` — does it double-decrement
 * reserved_credits? If yes, that's a credit-leak bug.
 *
 * The append path DOES check `if referenceId already exists, return
 * existing entry`, but the check only matches the EXACT referenceId
 * (`cancel:R` does not match `release:R`). So the append proceeds to
 * insert the row and runs the decrement side-effect.
 *
 * @spec INV-BILLING-003 — reservation lifecycle
 */

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_stale_reclaim_race'
})

const ServiceDeps = Layer.mergeAll(BillingStorePortLive, CreditLedgerStorePortLive)

type CreditService = Effect.Effect.Success<typeof makeCreditService>

const runService = async <A>(
  program: (svc: CreditService) => Effect.Effect<A, CoreError>
): Promise<Either.Either<A, CoreError>> => {
  const effect = Effect.gen(function* () {
    const svc = yield* makeCreditService
    return yield* program(svc)
  }).pipe(Effect.provide(ServiceDeps), Effect.either)
  return Effect.runPromise(effect)
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

const readBalance = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string
): Promise<{ creditsBalance: number; reservedCredits: number }> =>
  ctx.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{
      credits_balance: string
      reserved_credits: string
    }>(
      `SELECT credits_balance::text, reserved_credits::text
         FROM organizations
        WHERE id = $1`,
      [orgId]
    )
    return {
      creditsBalance: Number.parseInt(result.rows[0]?.credits_balance ?? '0', 10),
      reservedCredits: Number.parseInt(result.rows[0]?.reserved_credits ?? '0', 10)
    }
  })

/**
 * Seed a "stale" reserve row for the stale-reservation scan to pick up.
 *
 * credit_ledger is immutable per INV-BILLING-001 (UPDATE and DELETE are
 * blocked by a trigger), so we can't backdate an existing row — we INSERT
 * a new reserve row with an old created_at directly. INSERT is not
 * blocked, and the per-row balance_after is a lie but the scan only
 * reads entry_type / created_at / id / organization_id / amount, none
 * of which care about balance_after accuracy.
 *
 * Also bumps `organizations.reserved_credits` so the subsequent
 * reclaim-driven release has something to decrement.
 *
 * Returns the id of the inserted reserve row — used as the reservationId
 * in subsequent finalize / release / reclaim calls.
 */
const seedStaleReserve = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string,
  amountDecimillicents: number,
  hoursAgo: number
): Promise<string> => {
  return ctx.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO credit_ledger (
         organization_id, amount_decimillicents, entry_type, reason,
         reference_id, balance_after, created_at
       )
       VALUES ($1, $2, 'reserve', 'stale reclaim test',
         'stale-test-' || gen_random_uuid()::text,
         0, now() - ($3::int || ' hours')::INTERVAL)
       RETURNING id`,
      [orgId, amountDecimillicents, hoursAgo]
    )
    const reserveId = result.rows[0]?.id
    if (!reserveId) {
      throw new Error('Failed to seed stale reserve row')
    }
    await client.query(
      `UPDATE organizations
          SET reserved_credits = reserved_credits + $2
        WHERE id = $1`,
      [orgId, amountDecimillicents]
    )
    return reserveId
  })
}

// Stress concurrency is parameterised so local dev doesn't pay for 100
// Effect-runtime bootstraps per run (each call takes a connection from the
// pool and serialises on the org FOR UPDATE lock — 100× is ~20s wall-clock).
// 20 still exercises the race thoroughly; CI keeps the full 100 via the
// BILLING_STRESS_N env override.
const BILLING_STRESS_N = Number.parseInt(
  process.env.BILLING_STRESS_N ?? (process.env.CI === 'true' ? '100' : '20'),
  10
)

describe('stale reservation reclaim race', () => {
  // @spec INV-BILLING-003
  it(`${BILLING_STRESS_N} parallel reclaim runs against the same orphaned reservation collapse to exactly one release`, async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100_000)

    // Seed an orphaned stale reserve row directly. The 3-hour backdate
    // ensures the 2-hour scan picks it up.
    const reservationId = await seedStaleReserve(ctx, org.id, 5000, 3)

    const before = await readBalance(ctx, org.id)
    expect(before.reservedCredits).toBe(5000)

    // Fire N parallel reclaim runs against the same stale reservation.
    // The scan picks up the same row on every run, but the append path's
    // idempotency check (on `cancel:<id>` referenceId) means only the
    // first one actually decrements reserved_credits.
    const N = BILLING_STRESS_N
    const MAX_AGE_SECONDS = 2 * 60 * 60 // 2 hours
    const outcomes = await Promise.all(
      Array.from({ length: N }, () =>
        runService((svc) => svc.releaseStaleReservations(MAX_AGE_SECONDS))
      )
    )

    expectAllRight(outcomes, { context: `releaseStaleReservations ×${N}` })

    // Exactly one reclaim run did the work. The rest either (a) saw the
    // already-closed row and skipped via the scan's NOT EXISTS filter,
    // or (b) hit the `if referenceId exists, return existing` guard in
    // credit_ledger.append.
    const after = await readBalance(ctx, org.id)
    expect(after.reservedCredits).toBe(0)
    expect(after.creditsBalance).toBe(100_000)

    // The ledger must contain exactly one `cancel:` row for this reserve —
    // a lost update would show two or more.
    const cancelRows = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM credit_ledger
          WHERE organization_id = $1
            AND reference_id = $2`,
        [org.id, `cancel:${reservationId}`]
      )
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(cancelRows).toBe(1)
  })

  // @spec INV-BILLING-003
  it('concurrent reclaim + finalize on the same reservation does not double-release', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100_000)

    // Seed a stale orphaned reserve directly.
    const reservationId = await seedStaleReserve(ctx, org.id, 5000, 3)
    const MAX_AGE_SECONDS = 2 * 60 * 60

    // Fire reclaim AND finalize in parallel. Either one might land first.
    // The key invariant: reserved_credits MUST be exactly 0 after both
    // have committed — never 5_000 (uncommitted) or -5_000 (double release).
    const [reclaim] = await Promise.all([
      runService((svc) => svc.releaseStaleReservations(MAX_AGE_SECONDS)),
      runService((svc) =>
        svc.finalize({
          organizationId: org.id,
          reservationId,
          estimatedCostDecimillicents: 5000,
          actualCostDecimillicents: 3000,
          marginMultiplier: 1.10
        })
      )
    ])

    expect(Either.isRight(reclaim)).toBe(true)
    // finalize MIGHT fail if the reclaim already wrote the release row
    // and the finalize's internal "over-release" guard fires. Both
    // outcomes are acceptable — the invariant is the final DB state.

    const after = await readBalance(ctx, org.id)
    // reservedCredits MUST be exactly 0. Any drift indicates a race.
    expect(after.reservedCredits).toBe(0)
    // creditsBalance is either 100_000 (reclaim won, finalize rejected)
    // or 100_000 - Math.round(3_000 * 1.1) = 96_700 (finalize won).
    expect([100_000, 96_700]).toContain(after.creditsBalance)

    // Regardless of who won, the ledger must not contain MORE than one
    // net decrement of reserved_credits (i.e. at most one close row
    // that decrements from the reserve). In practice either:
    //   - `cancel:<id>` from the reclaim (reclaim won), OR
    //   - `release:<id>` + `usage`/debit row from the finalize (finalize won).
    // But NOT both.
    const closeRows = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{
        reference_id: string
        entry_type: string
      }>(
        `SELECT reference_id, entry_type
           FROM credit_ledger
          WHERE organization_id = $1
            AND (reference_id = $2 OR reference_id = $3 OR reference_id = $4)`,
        [
          org.id,
          `cancel:${reservationId}`,
          `release:${reservationId}`,
          `finalize:${reservationId}`
        ]
      )
      return result.rows
    })

    // Exactly one of the two paths committed:
    //   - reclaim path: [{ cancel:R, release }]
    //   - finalize path: [{ release:R, release }, { finalize:R, usage }]
    const cancelRow = closeRows.find((r) => r.reference_id === `cancel:${reservationId}`)
    const releaseRow = closeRows.find((r) => r.reference_id === `release:${reservationId}`)
    const finalizeRow = closeRows.find((r) => r.reference_id === `finalize:${reservationId}`)

    // Invariant: at most one of (cancelRow, releaseRow) exists. The
    // finalizeRow may or may not be present depending on which path won.
    const releaseLikeCount = [cancelRow, releaseRow].filter(Boolean).length
    expect(releaseLikeCount).toBeLessThanOrEqual(1)
    expect(releaseLikeCount).toBeGreaterThanOrEqual(1)

    // If finalize won, both release + finalize rows exist.
    if (releaseRow) {
      expect(finalizeRow).toBeDefined()
    }
  })

  // @spec INV-BILLING-003
  it('reclaim against an already-closed stale reserve is a no-op', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100_000)

    // Seed a stale reserve row AND a matching cancel close-row so the
    // scan's `NOT EXISTS (SELECT … WHERE reference_id = 'cancel:<id>')`
    // filter excludes it.
    const reservationId = await seedStaleReserve(ctx, org.id, 5000, 3)
    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `INSERT INTO credit_ledger (
           organization_id, amount_decimillicents, entry_type, reason,
           reference_id, balance_after, created_at
         )
         VALUES ($1, $2, 'release', 'pre-closed', $3, 0, now())`,
        [org.id, 5000, `cancel:${reservationId}`]
      )
      // Roll back the reserved_credits bump seedStaleReserve did — the
      // cancel row represents a prior release so the hold is already gone.
      await client.query(
        `UPDATE organizations
            SET reserved_credits = reserved_credits - 5000
          WHERE id = $1`,
        [org.id]
      )
    })

    // The scan MUST exclude this reserve via its NOT EXISTS filter.
    const stale = await runEffect(
      creditLedgerRepository.findStaleReservations({
        olderThan: new Date(Date.now() - 2 * 60 * 60 * 1000)
      })
    )
    const staleIds = stale.map((r) => r.id)
    expect(staleIds).not.toContain(reservationId)

    // The full reclaim service must be a no-op FOR THIS ORG. The service's
    // `releasedCount` is a system-wide count — under thread-pool integration
    // parallelism (pool: 'threads', isolate: false) other test files in the
    // same worker can leave their own stale reserves in the shared DB while
    // this test is running. Loosen the global count to >= 0 (we own zero)
    // and keep the strict per-org assertions below as the authoritative gate.
    const reclaim = await runService((svc) =>
      svc.releaseStaleReservations(2 * 60 * 60)
    )
    expect(Either.isRight(reclaim)).toBe(true)
    if (Either.isRight(reclaim)) {
      expect(reclaim.right.releasedCount).toBeGreaterThanOrEqual(0)
    }

    const balanceAfter = await readBalance(ctx, org.id)
    expect(balanceAfter.reservedCredits).toBe(0)
    expect(balanceAfter.creditsBalance).toBe(100_000)

    // Per-org authoritative gate: no additional `cancel:<reservationId>` row
    // was appended beyond the single pre-seeded one, and no stray release/
    // finalize row exists for this reservation id.
    const thisOrgRows = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM credit_ledger
          WHERE organization_id = $1
            AND reference_id = $2`,
        [org.id, `cancel:${reservationId}`]
      )
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(thisOrgRows).toBe(1)
  })

  // Silence unused-import hint for Option — kept around in case
  // assertions need it via `Option.isSome`.
  void Option
})
