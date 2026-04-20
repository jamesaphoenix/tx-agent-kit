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
 * Credit-history cursor pagination must be complete and non-skipping
 * even when multiple rows share the same `created_at` timestamp.
 *
 * Historical bug: `listForOrganization`'s keyset cursor filtered
 * `credit_ledger.id < :cursor` while sorting by `DESC created_at, DESC id`.
 * That works when every row has a unique `created_at`, but
 * `finalizeReservation` writes BOTH the release row AND the debit row
 * in a single transaction, so both rows get the same Postgres
 * `now()` timestamp. If the first page boundary lands exactly between
 * the twins (limit=1 on a brand-new finalize), the cursor carries
 * the first twin's id and the filter `id < cursor` drops ALL rows
 * whose uuid happens to sort above it — including the second twin.
 *
 * The fix is a compound keyset: `(created_at, id) <
 * (cursor.created_at, cursor.id)` so rows with a strictly smaller
 * created_at are always included regardless of their uuid, and
 * rows with the same created_at are filtered by id alone.
 *
 * @spec billing-and-pricing-design §"Credit ledger"
 */

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_credit_history_pagination'
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

describe('credit history cursor pagination (compound keyset)', () => {
  // @spec billing-and-pricing-design §"Credit ledger"
  it('never skips a row when two rows share the same created_at (finalize twins)', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await seedOrgCredits(ctx, org.id, 100_000)

    // Produce a finalizeReservation run that writes release+usage
    // twins in one transaction (identical created_at). Reserve first.
    const reserveOutcome = await runService((svc) =>
      svc.reserve({
        organizationId: org.id,
        estimatedCostDecimillicents: 5000,
        referenceId: `pagination-${org.id}`,
        reason: 'pagination test reserve'
      })
    )
    expect(Either.isRight(reserveOutcome)).toBe(true)
    if (!Either.isRight(reserveOutcome)) { return }
    const reservationId = reserveOutcome.right.reservationId

    const finalizeOutcome = await runService((svc) =>
      svc.finalize({
        organizationId: org.id,
        reservationId,
        estimatedCostDecimillicents: 5000,
        actualCostDecimillicents: 4000,
        marginMultiplier: 1
      })
    )
    expect(Either.isRight(finalizeOutcome)).toBe(true)

    // Sanity: the ledger has three rows — the reserve, the release,
    // and the usage (debit). The finalize twins are the release+usage
    // pair; both were written in the same transaction so they share
    // created_at.
    const allRows = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{
        id: string
        entry_type: string
        reference_id: string | null
        created_at: string
      }>(
        `SELECT id::text, entry_type, reference_id, created_at::text
           FROM credit_ledger
          WHERE organization_id = $1
          ORDER BY created_at DESC, id DESC`,
        [org.id]
      )
      return result.rows
    })
    expect(allRows).toHaveLength(3)

    // Confirm the finalize twins have identical created_at (that's
    // the precondition for the bug to manifest).
    const [first, second] = allRows
    expect(first?.created_at).toBe(second?.created_at)

    // Now paginate via the credit-ledger repo's keyset path with
    // limit=1. The first page MUST return exactly the first row,
    // the next page MUST return exactly the second row — regardless
    // of which direction the uuid comparison happens to go.
    const { creditLedgerRepository } = await import('@tx-agent-kit/db')

    const firstPage = await Effect.runPromise(
      creditLedgerRepository.listForOrganization({ organizationId: org.id, limit: 1 })
        .pipe(Effect.orDie)
    )
    expect(firstPage).toHaveLength(1)
    const firstPageId = firstPage[0]!.id

    const secondPage = await Effect.runPromise(
      creditLedgerRepository.listForOrganization({
        organizationId: org.id,
        limit: 1,
        cursor: firstPageId
      }).pipe(Effect.orDie)
    )
    // Without the fix, secondPage could be EMPTY when the cursor's uuid
    // happens to be the smaller of the two twins — the `id < cursor`
    // filter drops the other twin whose uuid is larger.
    expect(secondPage).toHaveLength(1)
    expect(secondPage[0]!.id).not.toBe(firstPageId)

    // Continue to the third row.
    const thirdPage = await Effect.runPromise(
      creditLedgerRepository.listForOrganization({
        organizationId: org.id,
        limit: 1,
        cursor: secondPage[0]!.id
      }).pipe(Effect.orDie)
    )
    expect(thirdPage).toHaveLength(1)

    // Fourth page is empty.
    const fourthPage = await Effect.runPromise(
      creditLedgerRepository.listForOrganization({
        organizationId: org.id,
        limit: 1,
        cursor: thirdPage[0]!.id
      }).pipe(Effect.orDie)
    )
    expect(fourthPage).toHaveLength(0)

    // The three returned ids must equal the three rows we seeded —
    // no skips, no duplicates.
    const paginatedIds = new Set([
      firstPage[0]!.id,
      secondPage[0]!.id,
      thirdPage[0]!.id
    ])
    expect(paginatedIds.size).toBe(3)
    const expected = new Set(allRows.map((r) => r.id))
    expect(paginatedIds).toEqual(expected)
  })
})
