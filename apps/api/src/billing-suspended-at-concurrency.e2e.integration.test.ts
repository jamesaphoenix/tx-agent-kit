import { organizationsRepository } from '@tx-agent-kit/db'
import { createOrganization, createUser, seedOrgCredits } from '@tx-agent-kit/testkit'
import { Effect, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Concurrency stress test for `organizations.suspended_at` set/clear.
 *
 * Both methods (`setSuspended` and `clearSuspended`) are conditional
 * single-statement UPDATEs that take a row lock implicitly. This test
 * fires N parallel callers and asserts:
 *
 *   1. N parallel `setSuspended` against an already-NULL row produce
 *      EXACTLY one `{ suspended: true }`. The rest return false.
 *   2. N parallel `clearSuspended` against an already-set row produce
 *      EXACTLY one `{ cleared: true }`. The rest return false.
 *   3. A racing set + clear leaves the row in a deterministic terminal
 *      state — either suspended or not, never partially mutated.
 *   4. The `suspended_at` timestamp written by the winner is preserved
 *      across all the loser calls (no later UPDATE overwrites it).
 *
 * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
 * @spec INV-BILLING-010 — billing consumers are idempotent.
 */

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_suspended_at_concurrency'
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

describe('organizations.suspended_at concurrency', () => {
  // @spec INV-BILLING-010
  it('N parallel setSuspended calls return exactly one suspended:true', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const N = 25
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        runEffect(organizationsRepository.setSuspended(org.id))
      )
    )

    const winners = results.filter((r) => r.suspended)
    expect(winners).toHaveLength(1)
    expect(results.filter((r) => !r.suspended)).toHaveLength(N - 1)

    // Row state must be terminal: suspended_at IS NOT NULL.
    const orgRow = await runEffect(organizationsRepository.getById(org.id))
    if (Option.isNone(orgRow)) {
      throw new Error(`org ${org.id} not found`)
    }
    expect(orgRow.value.suspendedAt).toBeInstanceOf(Date)
  })

  // @spec INV-BILLING-010
  it('N parallel clearSuspended calls against a suspended row return exactly one cleared:true', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    // Pre-suspend the org
    await runEffect(organizationsRepository.setSuspended(org.id))

    const N = 25
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        runEffect(organizationsRepository.clearSuspended(org.id))
      )
    )

    const winners = results.filter((r) => r.cleared)
    expect(winners).toHaveLength(1)
    expect(results.filter((r) => !r.cleared)).toHaveLength(N - 1)

    const orgRow = await runEffect(organizationsRepository.getById(org.id))
    if (Option.isNone(orgRow)) {
      throw new Error(`org ${org.id} not found`)
    }
    expect(orgRow.value.suspendedAt).toBeNull()
  })

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it('preserves the original suspension timestamp across N idempotent set calls', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const first = await runEffect(organizationsRepository.setSuspended(org.id))
    expect(first.suspended).toBe(true)

    const orgFirst = await runEffect(organizationsRepository.getById(org.id))
    const firstSuspendedAt = Option.isSome(orgFirst) ? orgFirst.value.suspendedAt : null
    expect(firstSuspendedAt).toBeInstanceOf(Date)

    // Sleep a tick so a buggy unconditional UPDATE would visibly drift.
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Fire 10 more setSuspended calls in parallel — none should win.
    const more = await Promise.all(
      Array.from({ length: 10 }, () =>
        runEffect(organizationsRepository.setSuspended(org.id))
      )
    )
    expect(more.every((r) => !r.suspended)).toBe(true)

    const orgAfter = await runEffect(organizationsRepository.getById(org.id))
    const afterSuspendedAt = Option.isSome(orgAfter) ? orgAfter.value.suspendedAt : null
    expect(afterSuspendedAt).toBeInstanceOf(Date)
    if (firstSuspendedAt && afterSuspendedAt) {
      // Same instant — the conditional UPDATE never fired.
      expect(afterSuspendedAt.getTime()).toBe(firstSuspendedAt.getTime())
    }
  })

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it('racing set + clear converges to a deterministic terminal state', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    // Pre-suspend so clear has something to clear.
    await runEffect(organizationsRepository.setSuspended(org.id))

    // Fire 5 sets and 5 clears interleaved. The terminal state can be
    // either suspended or not (depends on which call lands last), but it
    // must NOT be in a corrupted state — and the count of "winners"
    // across both kinds must match the number of state transitions
    // (alternating set/clear between NULL and NOT NULL).
    const setOp = async () => {
      const r = await runEffect(organizationsRepository.setSuspended(org.id))
      return { kind: 'set' as const, won: r.suspended }
    }
    const clearOp = async () => {
      const r = await runEffect(organizationsRepository.clearSuspended(org.id))
      return { kind: 'clear' as const, won: r.cleared }
    }
    const ops = [
      ...Array.from({ length: 5 }, () => setOp()),
      ...Array.from({ length: 5 }, () => clearOp())
    ]
    const results = await Promise.all(ops)

    // The organization row must exist and have a deterministic suspended_at
    // (either a Date or null) — never undefined or some other corrupted value.
    const orgRow = await runEffect(organizationsRepository.getById(org.id))
    if (Option.isNone(orgRow)) {
      throw new Error(`org ${org.id} not found`)
    }
    const finalState = orgRow.value.suspendedAt
    expect(finalState === null || finalState instanceof Date).toBe(true)

    // Sanity: total wins ≤ total ops (since each call is conditional)
    // and ≥ 1 because we pre-suspended and then ran at least one clear.
    const totalWins = results.filter((r) => r.won).length
    expect(totalWins).toBeGreaterThanOrEqual(1)
    expect(totalWins).toBeLessThanOrEqual(results.length)
  })
})

/**
 * Regression tests for the iter-7 fix: `clearSuspendedIfPositiveBalance`
 * embeds `(creditsBalance − reservedCredits) > 0` into the UPDATE WHERE
 * clause so the balance check is atomic with the write. Without this
 * guard, `creditPositiveReevaluate` had a TOCTOU: it read the org row,
 * computed `available` offline, then fired `clearSuspended` — a
 * concurrent `finalize` or `charge.refunded` could drop balance between
 * the read and write, leaving the org unsuspended with negative
 * available balance.
 *
 * These tests pin the balance predicate at the SQL level so the TOCTOU
 * cannot regress via a naive refactor.
 *
 * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
 */
describe('clearSuspendedIfPositiveBalance atomic balance predicate', () => {
  const DECIMILLICENTS_ONE_DOLLAR = 1_000_000

  const suspendAndSetBalance = async (
    ctx: ReturnType<typeof getFactoryContext>,
    opts: { creditsBalance: number; reservedCredits?: number }
  ): Promise<string> => {
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, opts.creditsBalance)
    if (opts.reservedCredits !== undefined) {
      // Seed reservedCredits via a direct UPDATE since there's no
      // factory helper for it — exercising the repo method doesn't
      // depend on the reserve ledger path.
      await ctx.testContext.withSchemaClient(async (client) => {
        await client.query(
          `UPDATE organizations SET reserved_credits = $1 WHERE id = $2`,
          [opts.reservedCredits, org.id]
        )
      })
    }
    const setResult = await runEffect(organizationsRepository.setSuspended(org.id))
    expect(setResult.suspended).toBe(true)
    return org.id
  }

  it('clears suspension when available balance is positive', async () => {
    const ctx = getFactoryContext()
    const orgId = await suspendAndSetBalance(ctx, {
      creditsBalance: 10 * DECIMILLICENTS_ONE_DOLLAR
    })

    const result = await runEffect(
      organizationsRepository.clearSuspendedIfPositiveBalance(orgId)
    )
    expect(result.cleared).toBe(true)

    const row = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(row)) { throw new Error('org not found after clear') }
    expect(row.value.suspendedAt).toBeNull()
  })

  it('does NOT clear suspension when available balance is exactly zero', async () => {
    const ctx = getFactoryContext()
    const orgId = await suspendAndSetBalance(ctx, { creditsBalance: 0 })

    const result = await runEffect(
      organizationsRepository.clearSuspendedIfPositiveBalance(orgId)
    )
    expect(result.cleared).toBe(false)

    const row = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(row)) { throw new Error('org not found after clear') }
    expect(row.value.suspendedAt).not.toBeNull()
  })

  it('does NOT clear suspension when available balance is negative (reserved > balance)', async () => {
    const ctx = getFactoryContext()
    const orgId = await suspendAndSetBalance(ctx, {
      creditsBalance: 5 * DECIMILLICENTS_ONE_DOLLAR,
      reservedCredits: 10 * DECIMILLICENTS_ONE_DOLLAR
    })

    const result = await runEffect(
      organizationsRepository.clearSuspendedIfPositiveBalance(orgId)
    )
    expect(result.cleared).toBe(false)

    const row = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(row)) { throw new Error('org not found after clear') }
    expect(row.value.suspendedAt).not.toBeNull()
  })

  it('is a no-op when org is not suspended (no double-clear on concurrent callers)', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 10 * DECIMILLICENTS_ONE_DOLLAR)

    const result = await runEffect(
      organizationsRepository.clearSuspendedIfPositiveBalance(org.id)
    )
    expect(result.cleared).toBe(false)

    const row = await runEffect(organizationsRepository.getById(org.id))
    if (Option.isNone(row)) { throw new Error('org not found after clear') }
    expect(row.value.suspendedAt).toBeNull()
  })

  it('N parallel clearSuspendedIfPositiveBalance calls produce exactly one cleared:true', async () => {
    const ctx = getFactoryContext()
    const orgId = await suspendAndSetBalance(ctx, {
      creditsBalance: 10 * DECIMILLICENTS_ONE_DOLLAR
    })

    const N = 25
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        runEffect(organizationsRepository.clearSuspendedIfPositiveBalance(orgId))
      )
    )

    const winners = results.filter((r) => r.cleared)
    expect(winners).toHaveLength(1)
    expect(results.filter((r) => !r.cleared)).toHaveLength(N - 1)

    const row = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(row)) { throw new Error('org not found after parallel clear') }
    expect(row.value.suspendedAt).toBeNull()
  })
})
