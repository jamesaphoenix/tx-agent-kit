import {
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  makeCreditService,
  type CoreError
} from '@tx-agent-kit/core'
import {
  createOrganization,
  createUser,
  seedOrgCredits
} from '@tx-agent-kit/testkit'
import { Effect, Either, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Stress test for the credit reservation lifecycle (reserve / finalize /
 * release) under contention.
 *
 * The reservation lifecycle is the most concurrency-sensitive billing
 * surface — every async AI operation goes through it, and a lost-update
 * here would mean over-spending an org. The append path serializes on
 * an `organizations FOR UPDATE` row lock, so all writes against the
 * same org id must be queued by Postgres.
 *
 * @spec INV-BILLING-003 — reservation lifecycle: reserve increases
 *   reserved_credits without touching credits_balance; finalize releases
 *   the hold + debits actual cost; release returns the hold without
 *   debiting; concurrent callers never observe a corrupted intermediate.
 * @spec INV-BILLING-004 — reservation contract: reserve must fail with
 *   payment_required when available balance is insufficient.
 */

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_reservation_lifecycle'
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

const readBalanceRow = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string
): Promise<{ creditsBalance: number; reservedCredits: number }> => {
  return ctx.testContext.withSchemaClient(async (client) => {
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
}

describe('credit reservation lifecycle concurrency', () => {
  // @spec INV-BILLING-004
  it('20 parallel reserves at the boundary admit exactly the affordable count', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    // $1.00 = 10_000 decimillicents. Each reserve costs $0.10 = 1_000.
    // 20 parallel reserves → exactly 10 should succeed, 10 should fail
    // with payment_required.
    const TOTAL = 10_000
    const COST = 1000
    const N = 20
    await seedOrgCredits(ctx, org.id, TOTAL)

    const outcomes = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runService((svc) =>
          svc.reserve({
            organizationId: org.id,
            estimatedCostDecimillicents: COST,
            referenceId: `boundary-${org.id}-${i.toString()}`,
            reason: 'boundary stress test'
          })
        )
      )
    )

    const successes = outcomes.filter((o) => Either.isRight(o))
    const failures = outcomes.filter((o) => Either.isLeft(o))

    expect(successes).toHaveLength(TOTAL / COST)
    expect(failures).toHaveLength(N - TOTAL / COST)

    // Every failure must be PAYMENT_REQUIRED — never a stray internal error.
    for (const f of failures) {
      if (Either.isLeft(f)) {
        expect(f.left.code).toBe('PAYMENT_REQUIRED')
      }
    }

    // Final accounting: creditsBalance unchanged, reservedCredits = 10 × 1_000.
    const balance = await readBalanceRow(ctx, org.id)
    expect(balance.creditsBalance).toBe(TOTAL)
    expect(balance.reservedCredits).toBe(TOTAL)
  })

  // @spec INV-BILLING-003
  it('100 parallel reserves of $0.01 each preserve exact reserved_credits accounting', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const TOTAL = 100_000 // $10
    const COST = 100 // $0.01
    const N = 100
    await seedOrgCredits(ctx, org.id, TOTAL)

    const outcomes = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runService((svc) =>
          svc.reserve({
            organizationId: org.id,
            estimatedCostDecimillicents: COST,
            referenceId: `parallel-reserve-${org.id}-${i.toString()}`,
            reason: 'parallel reserve stress test'
          })
        )
      )
    )

    expect(outcomes.every((o) => Either.isRight(o))).toBe(true)

    const balance = await readBalanceRow(ctx, org.id)
    expect(balance.creditsBalance).toBe(TOTAL)
    expect(balance.reservedCredits).toBe(N * COST)
  })

  // @spec INV-BILLING-003
  it('reserve → finalize on N parallel reservations leaves balance = TOTAL - sum(actuals)', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const TOTAL = 100_000
    const RESERVE_COST = 1000 // $0.10
    const ACTUAL_COST = 700 // $0.07 (less than reserve — common case)
    const N = 30
    await seedOrgCredits(ctx, org.id, TOTAL)

    // Reserve in parallel, collect ids
    const reserveOutcomes = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runService((svc) =>
          svc.reserve({
            organizationId: org.id,
            estimatedCostDecimillicents: RESERVE_COST,
            referenceId: `rf-reserve-${org.id}-${i.toString()}`,
            reason: 'reserve+finalize stress'
          })
        )
      )
    )
    const reservationIds: string[] = []
    for (const o of reserveOutcomes) {
      expect(Either.isRight(o)).toBe(true)
      if (Either.isRight(o)) {reservationIds.push(o.right.reservationId)}
    }

    // Finalize each with actual < reserve, in parallel.
    await Promise.all(
      reservationIds.map((reservationId) =>
        runService((svc) =>
          svc.finalize({
            organizationId: org.id,
            reservationId,
            estimatedCostDecimillicents: RESERVE_COST,
            actualCostDecimillicents: ACTUAL_COST,
            marginMultiplier: 1.10
          })
        )
      )
    )

    const balance = await readBalanceRow(ctx, org.id)
    // Reserved must be back to 0.
    expect(balance.reservedCredits).toBe(0)
    // Cross-check the org row against the credit_ledger ground truth.
    // Debits are stored with NEGATIVE amounts in credit_ledger (the
    // ledger sign convention is "increase = positive, decrease =
    // negative"), so summing the `finalize:` rows gives a negative
    // value and the org's creditsBalance must equal TOTAL + that sum.
    const ledger = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{
        entry_type: string
        amount_decimillicents: string
        reference_id: string | null
      }>(
        `SELECT entry_type, amount_decimillicents::text, reference_id
           FROM credit_ledger
          WHERE organization_id = $1
          ORDER BY created_at`,
        [org.id]
      )
      return result.rows
    })
    const debits = ledger.filter((r) => r.reference_id?.startsWith('finalize:'))
    const debitSum = debits.reduce(
      (sum, r) => sum + Number.parseInt(r.amount_decimillicents, 10),
      0
    )
    expect(balance.creditsBalance).toBe(TOTAL + debitSum)
    // Each debit row stores -Math.round(actual × marginMultiplier).
    // The credit-service uses Math.round (NOT Math.ceil) for finalize,
    // and `Math.round(700 * 1.10) = 770` even though `700 * 1.10` is
    // 770.0000000000001 in IEEE-754 (round-half-to-even tips it down).
    expect(debitSum).toBe(-N * Math.round(ACTUAL_COST * 1.1))
  })

  // @spec INV-BILLING-003
  // @spec INV-BILLING-010 — finalize must be idempotent under redelivery.
  // The repo's finalizeReservation early-returns if the release row for
  // this reservationId already exists — so a caller that re-invokes
  // finalize (e.g. Temporal activity retry after a crashed commit)
  // must NOT double-debit the org.
  it('finalize is idempotent — calling it twice with the same reservationId never double-debits', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await seedOrgCredits(ctx, org.id, 10_000)

    const reserveOutcome = await runService((svc) =>
      svc.reserve({
        organizationId: org.id,
        estimatedCostDecimillicents: 1000,
        referenceId: `finalize-idem-${org.id}`,
        reason: 'finalize idem test'
      })
    )
    expect(Either.isRight(reserveOutcome)).toBe(true)
    if (!Either.isRight(reserveOutcome)) { return }
    const reservationId = reserveOutcome.right.reservationId

    // First finalize: 1000 reserved → release + debit 750 actual.
    // Expected post-state: creditsBalance = 10_000 - 750 = 9_250,
    // reserved = 0.
    const firstFinalize = await runService((svc) =>
      svc.finalize({
        organizationId: org.id,
        reservationId,
        estimatedCostDecimillicents: 1000,
        actualCostDecimillicents: 750,
        marginMultiplier: 1
      })
    )
    expect(Either.isRight(firstFinalize)).toBe(true)

    const afterFirst = await readBalanceRow(ctx, org.id)
    expect(afterFirst.reservedCredits).toBe(0)
    expect(afterFirst.creditsBalance).toBe(9250)

    // Second finalize with the same reservationId — Temporal activity
    // retry scenario. MUST be a clean no-op.
    const secondFinalize = await runService((svc) =>
      svc.finalize({
        organizationId: org.id,
        reservationId,
        estimatedCostDecimillicents: 1000,
        actualCostDecimillicents: 750,
        marginMultiplier: 1
      })
    )
    // The second call returns successfully — not an error — because
    // the repo's idempotent early-return path finds the existing
    // close-row and yields the same row. Over-debit would surface as
    // a state mutation, not an error code.
    expect(Either.isRight(secondFinalize)).toBe(true)

    const afterSecond = await readBalanceRow(ctx, org.id)
    expect(afterSecond.reservedCredits).toBe(0)
    expect(afterSecond.creditsBalance).toBe(9250)

    // And exactly two credit_ledger close-rows exist (one release,
    // one debit) — no second pair leaked from the redelivered finalize.
    const rowCounts = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ entry_type: string; count: string }>(
        `SELECT entry_type, count(*)::text AS count
           FROM credit_ledger
          WHERE organization_id = $1
            AND reference_id IN ($2, $3)
          GROUP BY entry_type`,
        [org.id, `release:${reservationId}`, `finalize:${reservationId}`]
      )
      return Object.fromEntries(result.rows.map((r) => [r.entry_type, Number(r.count)]))
    })
    expect(rowCounts.release).toBe(1)
    expect(rowCounts.usage).toBe(1)
  })

  // @spec INV-BILLING-003
  // @spec INV-BILLING-010
  it('release is idempotent — a second release of the same reservationId is a no-op', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await seedOrgCredits(ctx, org.id, 10_000)

    // Reserve, then call release twice in parallel.
    const reserveOutcome = await runService((svc) =>
      svc.reserve({
        organizationId: org.id,
        estimatedCostDecimillicents: 1000,
        referenceId: `release-idem-${org.id}`,
        reason: 'release idem test'
      })
    )
    expect(Either.isRight(reserveOutcome)).toBe(true)
    if (!Either.isRight(reserveOutcome)) {return}
    const reservationId = reserveOutcome.right.reservationId

    const balanceBefore = await readBalanceRow(ctx, org.id)
    expect(balanceBefore.reservedCredits).toBe(1000)

    await Promise.all([
      runService((svc) =>
        svc.release({
          organizationId: org.id,
          reservationId,
          estimatedCostDecimillicents: 1000,
          reason: 'first release'
        })
      ),
      runService((svc) =>
        svc.release({
          organizationId: org.id,
          reservationId,
          estimatedCostDecimillicents: 1000,
          reason: 'second release'
        })
      )
    ])

    const balanceAfter = await readBalanceRow(ctx, org.id)
    // reserved_credits MUST drop by exactly 1_000 — never 2_000 (that
    // would be a double-release leaking credits back into the wallet).
    expect(balanceAfter.reservedCredits).toBe(0)
    expect(balanceAfter.creditsBalance).toBe(10_000)
  })
})
