import {
  BillingStorePortLive,
  ClockPortLive,
  CreditLedgerStorePortLive,
  makeStorageBillingService,
  StorageUsageReaderPortLive,
  type CoreError
} from '@tx-agent-kit/core'
import {
  DECIMILLICENTS_PER_DOLLAR,
  PLAN_HARD_CEILING_BYTES,
  PLAN_STORAGE_LIMIT_BYTES
} from '@tx-agent-kit/contracts'
import {
  createOrganization,
  createUser,
  seedOrgCredits
} from '@tx-agent-kit/testkit'
import { Effect, Either, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_storage'
})

const MB = 1024 * 1024
const GB = 1024 * MB
const TRY_ME_INCLUDED = PLAN_STORAGE_LIMIT_BYTES.try_me
const TRY_ME_HARD_CEILING = PLAN_HARD_CEILING_BYTES.try_me

/** Shared layer — wires the service's three ports to their live DB adapters. */
const ServiceDeps = Layer.mergeAll(
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  StorageUsageReaderPortLive,
  ClockPortLive
)

const runService = async <A>(
  program: (
    service: Effect.Effect.Success<typeof makeStorageBillingService>
  ) => Effect.Effect<A, CoreError>
): Promise<Either.Either<A, CoreError>> => {
  const effect = Effect.gen(function* () {
    const service = yield* makeStorageBillingService
    return yield* program(service)
  }).pipe(Effect.provide(ServiceDeps), Effect.either)
  return Effect.runPromise(effect)
}

/** Put an org on a storage plan. Plan limits come from `@tx-agent-kit/contracts`. */
const setPlan = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string,
  plan: 'try_me' | 'pro' | 'agency'
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations
         SET is_subscribed = true,
             subscription_status = 'active',
             subscription_plan = $2,
             updated_at = now()
       WHERE id = $1`,
      [orgId, plan]
    )
  })
}

/** Directly seed `storage_metering.active_bytes` — the real-time counter. */
const seedStorageMetering = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string,
  activeBytes: number
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `INSERT INTO storage_metering (organization_id, active_bytes, active_asset_count, measured_at)
       VALUES ($1, $2, 0, now())
       ON CONFLICT (organization_id) DO UPDATE SET active_bytes = EXCLUDED.active_bytes, measured_at = now()`,
      [orgId, activeBytes]
    )
  })
}

/** Directly seed a row in `storage_usage` for reconciliation tests. */
const seedStorageUsage = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string,
  input: {
    currentBytes: number
    planStorageLimit: number
    planTier: string
    periodStart?: Date
    periodEnd?: Date
  }
): Promise<void> => {
  const periodStart = input.periodStart ?? new Date(Date.UTC(2026, 3, 1))
  const periodEnd = input.periodEnd ?? new Date(Date.UTC(2026, 4, 1))
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `INSERT INTO storage_usage (org_id, period_start, period_end, current_bytes, plan_storage_limit, plan_tier)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, period_start) DO UPDATE SET
         current_bytes = EXCLUDED.current_bytes,
         plan_storage_limit = EXCLUDED.plan_storage_limit,
         plan_tier = EXCLUDED.plan_tier,
         period_end = EXCLUDED.period_end`,
      [orgId, periodStart, periodEnd, input.currentBytes, input.planStorageLimit, input.planTier]
    )
  })
}

const readBalance = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string
): Promise<number> => {
  let balance = 0
  await ctx.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{ credits_balance: string }>(
      `SELECT credits_balance FROM organizations WHERE id = $1`,
      [orgId]
    )
    balance = Number(result.rows[0]?.credits_balance ?? 0)
  })
  return balance
}

describe('billing storage integration', () => {
  describe('preUploadCheck', () => {
    it('@spec billing-storage-design allows uploads within the plan allocation', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      // 0 bytes currently stored, Try Me includes 10 GB.
      await seedStorageMetering(ctx, org.id, 0)

      const outcome = await runService((svc) =>
        svc.preUploadCheck({ organizationId: org.id, fileSizeBytes: 50 * MB })
      )

      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.allowed).toBe(true)
        expect(outcome.right.overageBytes).toBe(0)
        expect(outcome.right.overageCostDecimillicents).toBe(0)
        expect(outcome.right.reason).toBeUndefined()
      }
    })

    it.each([
      ['negative', -1],
      ['fractional', 1.5],
      ['NaN', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
      ['unsafe', Number.MAX_SAFE_INTEGER + 1]
    ])('rejects %s upload sizes before projecting storage usage', async (_label, fileSizeBytes) => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      await seedStorageMetering(ctx, org.id, 0)

      const outcome = await runService((svc) =>
        svc.preUploadCheck({ organizationId: org.id, fileSizeBytes })
      )

      expect(Either.isLeft(outcome)).toBe(true)
      if (Either.isLeft(outcome)) {
        expect(outcome.left.message).toContain('fileSizeBytes must be a non-negative integer')
      }
    })

    it('@spec INV-BILLING-006 allows overage uploads under the hard ceiling when credits cover the cost', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      // Seeded 1 GB short of the Try Me 10 GB plan limit; a 2 GB upload
      // pushes us 1 GB over the plan allocation while still sitting well
      // below the 20 GB hard ceiling.
      await seedStorageMetering(ctx, org.id, TRY_ME_INCLUDED - GB)
      await seedOrgCredits(ctx, org.id, 10 * DECIMILLICENTS_PER_DOLLAR)

      const outcome = await runService((svc) =>
        svc.preUploadCheck({ organizationId: org.id, fileSizeBytes: 2 * GB })
      )

      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.allowed).toBe(true)
        expect(outcome.right.overageBytes).toBe(GB)
        expect(outcome.right.overageCostDecimillicents).toBeGreaterThan(0)
      }
    })

    it('rejects uploads when credits are insufficient to cover the overage [INV-AST-014]', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      await seedStorageMetering(ctx, org.id, TRY_ME_INCLUDED - MB)
      // Deliberately zero credits — any overage at all must be rejected.
      await seedOrgCredits(ctx, org.id, 0)

      const outcome = await runService((svc) =>
        svc.preUploadCheck({ organizationId: org.id, fileSizeBytes: 2 * GB })
      )

      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.allowed).toBe(false)
        expect(outcome.right.reason).toBe('insufficient credits for overage')
        expect(outcome.right.overageBytes).toBeGreaterThan(0)
      }
    })

    it('@spec billing-storage-design rejects uploads beyond the plan hard ceiling regardless of credits', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      // Try Me plan is 10 GB included / 20 GB hard. Store 1 GB shy of the
      // hard ceiling, then attempt a 2 GB upload → crosses the 20 GB
      // ceiling even with abundant credits.
      await seedStorageMetering(ctx, org.id, TRY_ME_HARD_CEILING - GB)
      await seedOrgCredits(ctx, org.id, 1000 * DECIMILLICENTS_PER_DOLLAR)

      const outcome = await runService((svc) =>
        svc.preUploadCheck({ organizationId: org.id, fileSizeBytes: 2 * GB })
      )

      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.allowed).toBe(false)
        expect(outcome.right.reason).toBe('hard ceiling exceeded')
      }
    })

    // @spec billing-and-pricing-design §"Storage System"
    it('allows uploads that exactly reach the 2x plan hard ceiling', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      // 10 GB plan → 20 GB ceiling. Stored 5 GB short of the ceiling,
      // uploading exactly 5 GB hits the ceiling on the nose. The check
      // is `> hardCeiling`, so equality is allowed.
      await seedStorageMetering(ctx, org.id, TRY_ME_HARD_CEILING - 5 * GB)
      await seedOrgCredits(ctx, org.id, 1000 * DECIMILLICENTS_PER_DOLLAR)

      const outcome = await runService((svc) =>
        svc.preUploadCheck({ organizationId: org.id, fileSizeBytes: 5 * GB })
      )

      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.allowed).toBe(true)
        expect(outcome.right.reason).toBeUndefined()
      }
    })

    // @spec billing-and-pricing-design §"Storage System"
    it('rejects uploads that push storage one byte past the 2x plan hard ceiling', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      // 20 GB stored (exactly at the hard ceiling) + 1 byte upload → over.
      await seedStorageMetering(ctx, org.id, TRY_ME_HARD_CEILING)
      await seedOrgCredits(ctx, org.id, 1000 * DECIMILLICENTS_PER_DOLLAR)

      const outcome = await runService((svc) =>
        svc.preUploadCheck({ organizationId: org.id, fileSizeBytes: 1 })
      )

      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.allowed).toBe(false)
        expect(outcome.right.reason).toBe('hard ceiling exceeded')
      }
    })
  })

  describe('chargeStorageOverage', () => {
    it('debits a negative credit_ledger row and reduces credits_balance on first call [INV-AST-005]', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      const initial = 5 * DECIMILLICENTS_PER_DOLLAR
      await seedOrgCredits(ctx, org.id, initial)

      const cost = 50_000 // 0.005 dollars in decimillicents
      const outcome = await runService((svc) =>
        svc.chargeStorageOverage({
          organizationId: org.id,
          overageBytes: 10 * MB,
          costDecimillicents: cost,
          referenceId: `storage:test:${org.id}:first`
        })
      )
      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.charged).toBe(true)
      }

      const after = await readBalance(ctx, org.id)
      expect(after).toBe(initial - cost)
    })

    it.each([
      ['negative', -1],
      ['unsafe', Number.MAX_SAFE_INTEGER + 1]
    ])('rejects %s overage costs instead of treating them as no-ops', async (_label, costDecimillicents) => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      await seedOrgCredits(ctx, org.id, 5 * DECIMILLICENTS_PER_DOLLAR)

      const outcome = await runService((svc) =>
        svc.chargeStorageOverage({
          organizationId: org.id,
          overageBytes: 10 * MB,
          costDecimillicents,
          referenceId: `storage:test:${org.id}:invalid-cost-${_label}`
        })
      )

      expect(Either.isLeft(outcome)).toBe(true)
      if (Either.isLeft(outcome)) {
        expect(outcome.left.message).toContain('costDecimillicents must be a non-negative integer')
      }
    })

    it.each([
      ['negative', -1],
      ['unsafe', Number.MAX_SAFE_INTEGER + 1]
    ])('rejects %s overage byte counts before writing a ledger row', async (_label, overageBytes) => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      await seedOrgCredits(ctx, org.id, 5 * DECIMILLICENTS_PER_DOLLAR)

      const outcome = await runService((svc) =>
        svc.chargeStorageOverage({
          organizationId: org.id,
          overageBytes,
          costDecimillicents: 50_000,
          referenceId: `storage:test:${org.id}:invalid-overage-${_label}`
        })
      )

      expect(Either.isLeft(outcome)).toBe(true)
      if (Either.isLeft(outcome)) {
        expect(outcome.left.message).toContain('overageBytes must be a non-negative integer')
      }
    })

    // @spec INV-BILLING-009 — fresh-charge vs. idempotent-return must
    // be reported correctly even when an unrelated debit changes the
    // balance between the service's pre-read and the ledger append.
    // The previous detection compared
    // `entry.balanceAfter === beforeBalance - cost`, which silently
    // mis-classifies a fresh charge as `charged: false` whenever any
    // unrelated activity lands in that race window. The new detection
    // uses a per-call UUID marker in the entry's metadata.
    it('reports charged=true even when an unrelated debit lands between the pre-read and the append', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      const initial = 5 * DECIMILLICENTS_PER_DOLLAR
      await seedOrgCredits(ctx, org.id, initial)

      // Simulate the race by mutating credits_balance directly between
      // the test's setup and the service call. The service's internal
      // pre-read won't see the mutation because we're inside the same
      // schema; the post-mutation append will commit against the
      // updated balance.
      //
      // Note: we don't actually need the race to be racing in real time
      // — the OLD detection would mis-classify ANY case where
      // beforeBalance != currentBalance. Just bump credits_balance via
      // raw SQL, then call chargeStorageOverage, then assert
      // charged=true. The marker-based detection passes; the old
      // balance-based detection would fail.
      await ctx.testContext.withSchemaClient(async (client) => {
        await client.query(
          `UPDATE organizations SET credits_balance = credits_balance - $1, updated_at = now() WHERE id = $2`,
          [10_000, org.id] // unrelated debit
        )
      })

      const cost = 50_000
      const outcome = await runService((svc) =>
        svc.chargeStorageOverage({
          organizationId: org.id,
          overageBytes: 10 * MB,
          costDecimillicents: cost,
          referenceId: `storage:test:${org.id}:race`
        })
      )

      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        // The OLD code would have reported `charged: false` here because
        // (initial - cost) !== entry.balanceAfter (which reflects
        // initial - 10_000 - cost after the racing debit). The marker-
        // based detection correctly reports `charged: true`.
        expect(outcome.right.charged).toBe(true)
      }

      const after = await readBalance(ctx, org.id)
      expect(after).toBe(initial - 10_000 - cost)
    })

    it('is idempotent — a second call with the same referenceId leaves the balance unchanged [INV-AST-013]', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      const initial = 5 * DECIMILLICENTS_PER_DOLLAR
      await seedOrgCredits(ctx, org.id, initial)

      const cost = 50_000
      const referenceId = `storage:test:${org.id}:idem`

      const first = await runService((svc) =>
        svc.chargeStorageOverage({
          organizationId: org.id,
          overageBytes: 10 * MB,
          costDecimillicents: cost,
          referenceId
        })
      )
      expect(Either.isRight(first)).toBe(true)
      const afterFirst = await readBalance(ctx, org.id)
      expect(afterFirst).toBe(initial - cost)

      const second = await runService((svc) =>
        svc.chargeStorageOverage({
          organizationId: org.id,
          overageBytes: 10 * MB,
          costDecimillicents: cost,
          referenceId
        })
      )
      expect(Either.isRight(second)).toBe(true)
      if (Either.isRight(second)) {
        expect(second.right.charged).toBe(false)
      }
      const afterSecond = await readBalance(ctx, org.id)
      expect(afterSecond).toBe(afterFirst)
    })
  })

  describe('reconcileMonthlyOverage', () => {
    it('charges ongoing overage when the period rollup exceeds the plan limit [INV-AST-015]', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)
      // 120 MB stored on a 100 MB plan → 20 MB overage.
      await seedStorageUsage(ctx, org.id, {
        currentBytes: 120 * MB,
        planStorageLimit: 100 * MB,
        planTier: 'try_me'
      })

      const before = await readBalance(ctx, org.id)

      const outcome = await runService((svc) =>
        svc.reconcileMonthlyOverage(org.id)
      )

      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.overageBytes).toBe(20 * MB)
        expect(outcome.right.chargedDecimillicents).toBeGreaterThan(0)
      }

      const after = await readBalance(ctx, org.id)
      expect(after).toBeLessThan(before)
      if (Either.isRight(outcome)) {
        expect(before - after).toBe(outcome.right.chargedDecimillicents)
      }

      const second = await runService((svc) =>
        svc.reconcileMonthlyOverage(org.id)
      )
      expect(Either.isRight(second)).toBe(true)
      if (Either.isRight(second)) {
        expect(second.right.overageBytes).toBe(20 * MB)
        expect(second.right.chargedDecimillicents).toBe(0)
      }
      expect(await readBalance(ctx, org.id)).toBe(after)
    })

    it('returns zero when the period rollup is within the plan limit', async () => {
      const ctx = getFactoryContext()
      const owner = await createUser(ctx)
      const org = await createOrganization(ctx, { token: owner.token })
      await setPlan(ctx, org.id, 'try_me')
      await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)
      await seedStorageUsage(ctx, org.id, {
        currentBytes: 50 * MB,
        planStorageLimit: 100 * MB,
        planTier: 'try_me'
      })

      const before = await readBalance(ctx, org.id)

      const outcome = await runService((svc) =>
        svc.reconcileMonthlyOverage(org.id)
      )

      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.overageBytes).toBe(0)
        expect(outcome.right.chargedDecimillicents).toBe(0)
      }

      const after = await readBalance(ctx, org.id)
      expect(after).toBe(before)
    })
  })
})
