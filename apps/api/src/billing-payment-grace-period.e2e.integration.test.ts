import {
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  makeCreditService,
  type CoreError
} from '@tx-agent-kit/core'
import { DECIMILLICENTS_PER_DOLLAR } from '@tx-agent-kit/contracts'
import { createOrganization, createUser, seedOrgCredits } from '@tx-agent-kit/testkit'
import { Effect, Either, Layer } from 'effect'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Payment grace period enforcement — end to end.
 *
 * Spec (billing-and-pricing-design §"Failed Payment Lifecycle"):
 *
 *   invoice.payment_failed → set organizations.payment_grace_period_ends_at
 *                            = now() + 7 days
 *   Operations suspended (reads allowed, no new AI/uploads).
 *   invoice.paid during grace → cancel grace period, resume operations.
 *
 * Historical bug: the grace period column was written by the worker but
 * never read by any guard, so an org with a failed payment continued to
 * consume credits for new AI operations. And invoice.payment_succeeded
 * never cleared the column, so if we ever started enforcing it the state
 * would get stuck after a recovery.
 *
 * @spec billing-and-pricing-design §"Failed Payment Lifecycle"
 * @spec INV-BILLING-003 — reservation guard
 */

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_payment_grace_period'
})

const ServiceDeps = Layer.mergeAll(BillingStorePortLive, CreditLedgerStorePortLive)

type CreditService = Effect.Effect.Success<typeof makeCreditService>

const runReserve = async (
  orgId: string,
  amount: number,
  label: string
): Promise<Either.Either<{ reservationId: string; remainingBalance: number }, CoreError>> => {
  const effect = Effect.gen(function* () {
    const service: CreditService = yield* makeCreditService
    return yield* service.reserve({
      organizationId: orgId,
      estimatedCostDecimillicents: amount,
      referenceId: `${label}-${orgId}`,
      reason: `payment-grace-test ${label}`
    })
  }).pipe(Effect.provide(ServiceDeps), Effect.either)
  return Effect.runPromise(effect)
}

const setGracePeriod = async (
  ctx: ReturnType<typeof getFactoryContext>,
  orgId: string,
  endsAt: Date | null
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET payment_grace_period_ends_at = $1, updated_at = now() WHERE id = $2`,
      [endsAt, orgId]
    )
  })
}

describe('payment grace period enforcement', () => {
  // @spec billing-and-pricing-design §"Failed Payment Lifecycle"
  it('rejects reserve when payment_grace_period_ends_at is set (active grace)', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `grace-active-${uid}@example.com`,
      password: 'grace-active-pass-12345',
      name: 'Grace Active Owner'
    })
    const org = await createOrganization(ctx, { token: owner.token, name: 'Grace Active Org' })
    await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)

    // Mid-grace window — 3 days from now.
    const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    await setGracePeriod(ctx, org.id, endsAt)

    const outcome = await runReserve(org.id, 5000, 'grace-active')

    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect(outcome.left.code).toBe('PAYMENT_REQUIRED')
      expect(outcome.left.message).toMatch(/grace|suspended|payment/i)
    }

    // Credit state untouched.
    const state = await ctx.testContext.withSchemaClient(async (client) => {
      const r = await client.query<{ reserved_credits: string; credits_balance: string }>(
        'SELECT reserved_credits::text, credits_balance::text FROM organizations WHERE id = $1',
        [org.id]
      )
      return r.rows[0]
    })
    expect(Number(state?.reserved_credits)).toBe(0)
    expect(Number(state?.credits_balance)).toBe(100 * DECIMILLICENTS_PER_DOLLAR)
  })

  // @spec billing-and-pricing-design §"Failed Payment Lifecycle"
  it('rejects reserve when grace period has already expired (still unresolved)', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `grace-expired-${uid}@example.com`,
      password: 'grace-expired-pass-12345',
      name: 'Grace Expired Owner'
    })
    const org = await createOrganization(ctx, { token: owner.token, name: 'Grace Expired Org' })
    await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)

    // 10 days ago — expired. The column being non-null means the unresolved
    // payment failure is still in effect: it is cleared ONLY by a successful
    // payment, not by wall-clock time.
    const endsAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await setGracePeriod(ctx, org.id, endsAt)

    const outcome = await runReserve(org.id, 5000, 'grace-expired')
    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect(outcome.left.code).toBe('PAYMENT_REQUIRED')
    }
  })

  // @spec billing-and-pricing-design §"Failed Payment Lifecycle"
  it('GET /credits surfaces paymentGracePeriodEndsAt and flips isSuspended to true', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `grace-surface-${uid}@example.com`,
      password: 'grace-surface-pass-12345',
      name: 'Grace Surface Owner'
    })
    const org = await createOrganization(ctx, { token: owner.token, name: 'Grace Surface Org' })

    const endsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    await setGracePeriod(ctx, org.id, endsAt)

    const res = await request<{
      creditsBalanceDecimillicents: number
      reservedCreditsDecimillicents: number
      availableDecimillicents: number
      isSuspended: boolean
      suspendedAt: string | null
      paymentGracePeriodEndsAt: string | null
    }>(
      `/v1/billing/${org.id}/credits`,
      'grace-surface-balance',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${owner.token}` }
      }
    )

    expect(res.response.status).toBe(200)
    expect(res.body.isSuspended).toBe(true) // grace period flips the flag
    expect(res.body.suspendedAt).toBeNull() // but suspended_at is untouched
    expect(res.body.paymentGracePeriodEndsAt).not.toBeNull()
    // Tolerance for second-level rounding in ISO serialization.
    const returnedMs = new Date(res.body.paymentGracePeriodEndsAt ?? '').getTime()
    expect(Math.abs(returnedMs - endsAt.getTime())).toBeLessThan(1000)
  })

  // @spec billing-and-pricing-design §"Failed Payment Lifecycle"
  it('invoice.payment_succeeded webhook clears payment_grace_period_ends_at', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `grace-clear-${uid}@example.com`,
      password: 'grace-clear-pass-12345',
      name: 'Grace Clear Owner'
    })
    const org = await createOrganization(ctx, { token: owner.token, name: 'Grace Clear Org' })

    // Set up: org was in past_due with grace period; Stripe customer linked.
    const customer = `cus_grace_clear_${uid}`
    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations
            SET stripe_customer_id = $1,
                stripe_subscription_id = $2,
                subscription_status = 'past_due',
                payment_grace_period_ends_at = $3
          WHERE id = $4`,
        [customer, `sub_grace_clear_${uid}`, new Date(Date.now() + 3 * 86_400_000), org.id]
      )
    })

    // Fire invoice.payment_succeeded.
    const payload = {
      id: `evt_grace_clear_${uid}`,
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: `in_grace_clear_${uid}`,
          customer,
          subscription: `sub_grace_clear_${uid}`
        }
      }
    }
    const res = await request<{ processed: boolean }>('/v1/webhooks/stripe', 'grace-clear-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(payload)
    })
    expect(res.response.status).toBe(200)

    // Grace period cleared, status bumped back to active.
    const after = await ctx.testContext.withSchemaClient(async (client) => {
      const r = await client.query<{
        payment_grace_period_ends_at: Date | null
        subscription_status: string
      }>(
        'SELECT payment_grace_period_ends_at, subscription_status FROM organizations WHERE id = $1',
        [org.id]
      )
      return r.rows[0]
    })
    expect(after?.payment_grace_period_ends_at).toBeNull()
    expect(after?.subscription_status).toBe('active')

    // Reserve now succeeds — the previous grace period was the ONLY block,
    // so the guard passes.
    await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)
    const reserveOutcome = await runReserve(org.id, 5000, 'grace-clear-post')
    expect(Either.isRight(reserveOutcome)).toBe(true)
  })

  // Regression for the iter-16 fix: `invoice.payment_failed` must set
  // `paymentGracePeriodEndsAt` **synchronously** inside the webhook
  // transaction, not hours later via a worker activity. Previously only
  // the worker's `startPaymentGracePeriod` activity wrote the column,
  // leaving a short window where the org was past_due but the column
  // was null — `reserve()` would allow new spend during that window,
  // violating the spec's "operations suspended" rule. The test snapshots
  // the org row IMMEDIATELY after the webhook returns, before any worker
  // activity would have had time to run.
  //
  // @spec billing-and-pricing-design §"Failed Payment Lifecycle"
  it('invoice.payment_failed webhook sets payment_grace_period_ends_at synchronously', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `grace-sync-${uid}@example.com`,
      password: 'grace-sync-pass-12345',
      name: 'Grace Sync Owner'
    })
    const org = await createOrganization(ctx, { token: owner.token, name: 'Grace Sync Org' })

    const customer = `cus_grace_sync_${uid}`
    const subscriptionId = `sub_grace_sync_${uid}`

    // Pre-link the org as active with a subscription. Grace period column
    // MUST start null so we can prove the webhook transitions it.
    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE organizations
            SET stripe_customer_id = $1,
                stripe_subscription_id = $2,
                subscription_status = 'active',
                payment_grace_period_ends_at = NULL
          WHERE id = $3`,
        [customer, subscriptionId, org.id]
      )
    })

    // Sanity: column is null before the webhook.
    const before = await ctx.testContext.withSchemaClient(async (client) => {
      const r = await client.query<{ payment_grace_period_ends_at: Date | null }>(
        'SELECT payment_grace_period_ends_at FROM organizations WHERE id = $1',
        [org.id]
      )
      return r.rows[0]
    })
    expect(before?.payment_grace_period_ends_at).toBeNull()

    // Fire invoice.payment_failed.
    const payload = {
      id: `evt_grace_sync_${uid}`,
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: `in_grace_sync_${uid}`,
          customer,
          subscription: subscriptionId
        }
      }
    }
    const res = await request<{ processed: boolean }>('/v1/webhooks/stripe', 'grace-sync-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(payload)
    })
    expect(res.response.status).toBe(200)

    // Immediately snapshot the row. If the webhook only set
    // subscription_status='past_due' and deferred the column write to a
    // worker activity, this read would see `null` for the grace period
    // because the read happens before the outbox publisher has time to
    // dispatch. The test MUST see a non-null value to prove the webhook
    // wrote it synchronously.
    const after = await ctx.testContext.withSchemaClient(async (client) => {
      const r = await client.query<{
        payment_grace_period_ends_at: Date | null
        subscription_status: string
      }>(
        'SELECT payment_grace_period_ends_at, subscription_status FROM organizations WHERE id = $1',
        [org.id]
      )
      return r.rows[0]
    })
    expect(after?.payment_grace_period_ends_at).not.toBeNull()
    expect(after?.subscription_status).toBe('past_due')

    // The grace period end time should be ~7 days in the future. Allow a
    // 60-second window for clock skew between the test process and the
    // Effect clock service used by the webhook handler.
    const now = Date.now()
    const expectedEndsAt = now + 7 * 86_400_000
    const actualEndsAt = after?.payment_grace_period_ends_at?.getTime() ?? 0
    expect(actualEndsAt).toBeGreaterThan(expectedEndsAt - 60_000)
    expect(actualEndsAt).toBeLessThan(expectedEndsAt + 60_000)

    // Reserve must also be blocked immediately — the whole point of the
    // synchronous write is that the reserve-time guard sees the column
    // without any timing dependency on the worker.
    await seedOrgCredits(ctx, org.id, 100 * DECIMILLICENTS_PER_DOLLAR)
    const reserveOutcome = await runReserve(org.id, 5000, 'grace-sync-block')
    expect(Either.isLeft(reserveOutcome)).toBe(true)
  })
})
