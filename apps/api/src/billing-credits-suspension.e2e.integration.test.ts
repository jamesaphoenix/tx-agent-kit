import {
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  makeCreditService,
  type CoreError
} from '@tx-agent-kit/core'
import { DECIMILLICENTS_PER_DOLLAR } from '@tx-agent-kit/contracts'
import {
  createOrganization,
  createUser,
  seedOrgCredits
} from '@tx-agent-kit/testkit'
import { Effect, Either, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Integration tests for the credit-service `reserve` suspension guard.
 *
 * The credit-positive re-evaluation pattern is a two-phase contract:
 *   1. When usage_cap_exceeded fires or a dispute is opened, the billing
 *      worker sets `organizations.suspended_at`.
 *   2. Until the flag is cleared (creditPositiveReevaluate after top-up),
 *      ALL credit-consuming operations must be rejected at the point of
 *      reservation — not just skipped downstream.
 *
 * These tests exercise that guard end-to-end against real Postgres via the
 * full CreditService runtime, using `createCreditService` directly rather
 * than an API route so the service-layer check is isolated from any HTTP
 * middleware.
 *
 * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
 * @spec INV-BILLING-004 — reservation contract
 */

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_credits_suspension'
})

const ServiceDeps = Layer.mergeAll(BillingStorePortLive, CreditLedgerStorePortLive)

type CreditService = Effect.Effect.Success<typeof makeCreditService>

const runService = async <A>(
  program: (service: CreditService) => Effect.Effect<A, CoreError>
): Promise<Either.Either<A, CoreError>> => {
  const effect = Effect.gen(function* () {
    const service = yield* makeCreditService
    return yield* program(service)
  }).pipe(Effect.provide(ServiceDeps), Effect.either)
  return Effect.runPromise(effect)
}

const suspendOrg = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET suspended_at = now() WHERE id = $1`,
      [orgId]
    )
  })
}

const unsuspendOrg = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET suspended_at = NULL WHERE id = $1`,
      [orgId]
    )
  })
}

describe('credit service suspension guard', () => {
  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it('rejects reserve with 402 paymentRequired when organizations.suspended_at IS NOT NULL', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)
    await suspendOrg(ctx, org.id)

    const outcome = await runService((svc) =>
      svc.reserve({
        organizationId: org.id,
        estimatedCostDecimillicents: 5000,
        referenceId: `suspend-test-${org.id}`,
        reason: 'integration test reserve attempt'
      })
    )

    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect(outcome.left.code).toBe('PAYMENT_REQUIRED')
      expect(outcome.left.message).toContain('suspended')
    }
  })

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it('leaves credit state untouched when a suspended reserve is rejected', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)
    await suspendOrg(ctx, org.id)

    await runService((svc) =>
      svc.reserve({
        organizationId: org.id,
        estimatedCostDecimillicents: 5000,
        referenceId: `suspend-test-ledger-${org.id}`,
        reason: 'integration test reserve attempt'
      })
    )

    // The reserve was rejected before touching the ledger. Confirm:
    //   1. No credit_ledger row was appended
    //   2. creditsBalance + reservedCredits are unchanged
    const result = await ctx.testContext.withSchemaClient(async (client) => {
      const ledger = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM credit_ledger WHERE organization_id = $1`,
        [org.id]
      )
      const org_ = await client.query<{
        credits_balance: string
        reserved_credits: string
      }>(
        `SELECT credits_balance::text, reserved_credits::text FROM organizations WHERE id = $1`,
        [org.id]
      )
      return {
        ledgerCount: Number.parseInt(ledger.rows[0]?.count ?? '0', 10),
        creditsBalance: Number.parseInt(org_.rows[0]?.credits_balance ?? '0', 10),
        reservedCredits: Number.parseInt(org_.rows[0]?.reserved_credits ?? '0', 10)
      }
    })

    // The seedOrgCredits helper writes one prior ledger row for the top-up.
    // The guard must NOT add a second 'reserve' row.
    expect(result.ledgerCount).toBeLessThanOrEqual(1)
    expect(result.creditsBalance).toBe(100 * DECIMILLICENTS_PER_DOLLAR)
    expect(result.reservedCredits).toBe(0)
  })

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it('accepts reserve again after suspended_at is cleared', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)

    await suspendOrg(ctx, org.id)
    const firstOutcome = await runService((svc) =>
      svc.reserve({
        organizationId: org.id,
        estimatedCostDecimillicents: 5000,
        referenceId: `first-${org.id}`,
        reason: 'test — should fail'
      })
    )
    expect(Either.isLeft(firstOutcome)).toBe(true)

    await unsuspendOrg(ctx, org.id)
    const secondOutcome = await runService((svc) =>
      svc.reserve({
        organizationId: org.id,
        estimatedCostDecimillicents: 5000,
        referenceId: `second-${org.id}`,
        reason: 'test — should succeed'
      })
    )

    expect(Either.isRight(secondOutcome)).toBe(true)
    if (Either.isRight(secondOutcome)) {
      expect(secondOutcome.right.reservationId).toMatch(/[0-9a-f-]{36}/)
      expect(secondOutcome.right.remainingBalance).toBe(100 * DECIMILLICENTS_PER_DOLLAR - 5000)
    }
  })

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it('allows reserve on a healthy (non-suspended) org as a baseline', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)

    const outcome = await runService((svc) =>
      svc.reserve({
        organizationId: org.id,
        estimatedCostDecimillicents: 5000,
        referenceId: `healthy-${org.id}`,
        reason: 'baseline reservation'
      })
    )

    expect(Either.isRight(outcome)).toBe(true)
  })
})
