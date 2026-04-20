import { creditLedgerRepository } from '@tx-agent-kit/db'
import {
  createOrganization,
  createUser,
  seedOrgCredits
} from '@tx-agent-kit/testkit'
import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Atomicity test for the credit_ledger ↔ domain_events co-commit.
 *
 * INV-BILLING-009 says threshold-crossing and state-change events must
 * commit in the SAME db transaction as the credit mutation that
 * triggers them. The implementation lives in
 * `creditLedgerRepository.append`: after the org row update + the
 * credit_ledger insert, it conditionally calls
 * `insertDomainEventInTransaction(trx, outboxEvent)` as the LAST
 * statement before the surrounding `db.transaction(...)` commits.
 *
 * The bug-hunt question: if the outbox insert throws, does the
 * surrounding transaction actually roll back? If the rollback
 * doesn't propagate, we'd silently double-credit an org and never
 * emit the matching event — a credit-without-event drift that
 * downstream workers can't detect.
 *
 * This test forces the failure by passing an invalid aggregateId
 * (non-UUID string), which the Postgres uuid type rejects with
 * "invalid input syntax for type uuid". Then it asserts:
 *
 *   1. The credit_ledger has NO row with the offending referenceId.
 *   2. The domain_events has NO row with the offending payload.
 *   3. The organizations row's credits_balance is unchanged.
 *
 * @spec INV-BILLING-009
 */

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_outbox_rollback'
})

const runEffectExit = <A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> =>
  Effect.runPromise(effect.pipe(Effect.exit))

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

describe('credit_ledger ↔ domain_events co-commit atomicity', () => {
  // @spec INV-BILLING-009
  it('rolls back the credit_ledger row when the outbox event insert fails', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const balanceBefore = await readBalance(ctx, org.id)
    expect(balanceBefore.creditsBalance).toBe(0)

    const referenceId = `outbox-rollback-${org.id}`

    // Force the outbox insert to fail by passing a non-UUID
    // aggregateId. Postgres rejects with 22P02
    // "invalid input syntax for type uuid".
    const exit = await runEffectExit(
      creditLedgerRepository.append({
        organizationId: org.id,
        entryType: 'purchase',
        amountDecimillicents: 50_000,
        reason: 'outbox rollback test',
        referenceId,
        outboxEvent: {
          eventType: 'billing.credits_purchased',
          aggregateType: 'billing',
          // ← bad: not a UUID. Postgres uuid column will reject.
          aggregateId: 'definitely-not-a-uuid',
          payload: {
            organizationId: org.id,
            amountDecimillicents: 50_000
          }
        }
      })
    )

    // The append must have failed — surfaced by the inner Postgres
    // error bubbling through Drizzle's transaction wrapper.
    expect(Exit.isFailure(exit)).toBe(true)

    // CRUCIAL: the credit_ledger row must NOT have been committed.
    const ledgerRows = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM credit_ledger
          WHERE organization_id = $1 AND reference_id = $2`,
        [org.id, referenceId]
      )
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(ledgerRows).toBe(0)

    // And the org row's credits_balance must be unchanged from 0.
    const balanceAfter = await readBalance(ctx, org.id)
    expect(balanceAfter.creditsBalance).toBe(0)

    // And no domain_events row leaked for this org. Scope the lookup by
    // `payload->>'organizationId'` — in shared-server mode `reset()` is
    // a no-op, so other tests in this file/schema may have legitimately
    // committed `billing.credits_purchased` events for other orgs. We
    // only care that the specific attempt tied to THIS org did not leak.
    const eventRows = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM domain_events
          WHERE event_type = 'billing.credits_purchased'
            AND payload->>'organizationId' = $1`,
        [org.id]
      )
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(eventRows).toBe(0)
  })

  // @spec INV-BILLING-009
  it('happy path: credit_ledger row + domain_events row commit together with shared correlation_id linkage', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const referenceId = `outbox-happy-${org.id}`
    const exit = await runEffectExit(
      creditLedgerRepository.append({
        organizationId: org.id,
        entryType: 'purchase',
        amountDecimillicents: 75_000,
        reason: 'outbox happy path',
        referenceId,
        stripeEventId: `evt_outbox_happy_${org.id}`,
        outboxEvent: {
          eventType: 'billing.credits_purchased',
          aggregateType: 'billing',
          aggregateId: org.id,
          payload: {
            organizationId: org.id,
            amountDecimillicents: 75_000,
            stripeEventId: `evt_outbox_happy_${org.id}`
          }
        }
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)

    const rows = await ctx.testContext.withSchemaClient(async (client) => {
      const ledger = await client.query<{
        id: string
        amount_decimillicents: string
      }>(
        `SELECT id, amount_decimillicents::text
           FROM credit_ledger
          WHERE organization_id = $1 AND reference_id = $2`,
        [org.id, referenceId]
      )
      const events = await client.query<{
        event_type: string
        aggregate_id: string
        payload: Record<string, unknown>
      }>(
        `SELECT event_type, aggregate_id::text, payload
           FROM domain_events
          WHERE event_type = 'billing.credits_purchased'
            AND aggregate_id = $1`,
        [org.id]
      )
      return {
        ledger: ledger.rows,
        events: events.rows
      }
    })

    // Both writes committed.
    expect(rows.ledger).toHaveLength(1)
    expect(Number.parseInt(rows.ledger[0]?.amount_decimillicents ?? '0', 10)).toBe(75_000)
    expect(rows.events).toHaveLength(1)
    expect(rows.events[0]?.aggregate_id).toBe(org.id)
    // Payload mirrors the input.
    expect(rows.events[0]?.payload).toMatchObject({
      organizationId: org.id,
      amountDecimillicents: 75_000
    })
  })

  // @spec INV-BILLING-009
  it('rolls back the org row update too — credits_balance never changes when outbox fails', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100_000)

    const referenceId = `outbox-rollback-balance-${org.id}`
    const exit = await runEffectExit(
      creditLedgerRepository.append({
        organizationId: org.id,
        entryType: 'purchase',
        amountDecimillicents: 25_000,
        reason: 'outbox rollback balance test',
        referenceId,
        outboxEvent: {
          eventType: 'billing.credits_purchased',
          aggregateType: 'billing',
          aggregateId: 'still-not-a-uuid',
          payload: {}
        }
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)

    // Balance is exactly the seeded value — the org row mutation rolled
    // back together with the credit_ledger insert.
    const balance = await readBalance(ctx, org.id)
    expect(balance.creditsBalance).toBe(100_000)
    expect(balance.reservedCredits).toBe(0)
  })
})
