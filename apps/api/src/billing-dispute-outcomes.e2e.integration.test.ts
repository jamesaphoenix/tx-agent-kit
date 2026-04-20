import { randomUUID } from 'node:crypto'
import {
  createOrganization,
  createUser,
  seedOrgCredits
} from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * charge.dispute.closed outcome handling.
 *
 * Stripe closes disputes with one of three statuses:
 *   - `won`            — merchant wins, no deduction, release the hold
 *   - `lost`           — merchant loses, deduct the disputed amount
 *   - `warning_closed` — inquiry closed without a chargeback, no-op
 *
 * Historical bug: `rawOutcome === 'lost' ? 'lost' : 'won'` was fail-open.
 * If Stripe ever sent an unexpected status (schema drift, malformed event),
 * the handler silently treated it as 'won' — meaning a real 'lost' outcome
 * could be skipped as a no-op if the field's shape ever changed. For
 * financial safety we now reject unknown statuses with a 4xx so Stripe
 * retries and on-call can investigate.
 *
 * @spec INV-BILLING-009 — atomic ledger commit + outbox event
 */

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_dispute_outcomes'
})

const baseBalance = 500_000_000 // $50

const seedOrgWithCustomer = async (suffix: string): Promise<{ orgId: string; customer: string }> => {
  const ctx = getFactoryContext()
  const owner = await createUser(ctx, {
    email: `dispute-outcomes-${suffix}-${uid}@example.com`,
    password: 'dispute-outcomes-pass-12345',
    name: `Dispute Outcomes ${suffix} Owner`
  })
  const org = await createOrganization(ctx, {
    token: owner.token,
    name: `Dispute Outcomes ${suffix} Org`
  })
  const customer = `cus_dispute_${suffix}_${uid}`
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      'UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2',
      [customer, org.id]
    )
  })
  await seedOrgCredits(ctx, org.id, baseBalance)
  return { orgId: org.id, customer }
}

const disputeCreatedEvent = (
  customer: string,
  eventId: string,
  amount: unknown
) => ({
  id: eventId,
  type: 'charge.dispute.created',
  data: {
    object: {
      id: `dp_${eventId}`,
      customer,
      amount
    }
  }
})

const disputeClosedEvent = (
  customer: string,
  eventId: string,
  opts: { status?: string; amount?: number } = {}
) => ({
  id: eventId,
  type: 'charge.dispute.closed',
  data: {
    object: {
      id: `dp_${eventId}`,
      customer,
      amount: opts.amount ?? 1000, // 1000 cents = $10 = 100_000_000 decimillicents
      ...(opts.status !== undefined ? { status: opts.status } : {})
    }
  }
})

describe('charge.dispute.created payload handling', () => {
  // @spec INV-BILLING-009
  it.each([
    ['missing amount', undefined],
    ['zero amount', 0],
    ['malformed amount', 'not-a-number'],
    ['overflow amount', Number.MAX_SAFE_INTEGER]
  ])('rejects dispute.created with %s before committing a hold', async (_label, amount) => {
    const { customer, orgId } = await seedOrgWithCustomer(`created-bad-${_label.replaceAll(' ', '-')}`)
    const eventId = `evt_dispute_created_bad_${randomUUID().slice(0, 8)}`

    const res = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      `dispute-created-bad-${_label}`,
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(disputeCreatedEvent(customer, eventId, amount))
      }
    )

    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const ledger = await client.query<{ id: string }>(
        'SELECT id FROM credit_ledger WHERE stripe_event_id = $1',
        [eventId]
      )
      expect(ledger.rows).toHaveLength(0)

      const outbox = await client.query<{ id: string }>(
        `SELECT id FROM domain_events
         WHERE event_type = 'billing.dispute_created' AND aggregate_id = $1`,
        [orgId]
      )
      expect(outbox.rows).toHaveLength(0)

      const claim = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM processed_stripe_events WHERE event_id = $1',
        [eventId]
      )
      expect(Number.parseInt(claim.rows[0]?.count ?? '0', 10)).toBe(0)
    })
  })
})

describe('charge.dispute.closed outcome handling', () => {
  // @spec INV-BILLING-009
  it('rejects dispute.closed with missing status (fail-closed)', async () => {
    const { customer, orgId } = await seedOrgWithCustomer('missing')
    const eventId = `evt_dispute_missing_${uid}`

    const res = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      'dispute-closed-missing-status',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(disputeClosedEvent(customer, eventId, {}))
      }
    )

    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)

    // Nothing should have been written. Balance untouched, no ledger row
    // for this event, no outbox event.
    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance)

      const ledger = await client.query<{ id: string }>(
        'SELECT id FROM credit_ledger WHERE stripe_event_id = $1',
        [eventId]
      )
      expect(ledger.rows).toHaveLength(0)

      const outbox = await client.query<{ id: string }>(
        `SELECT id FROM domain_events
         WHERE event_type = 'billing.dispute_resolved' AND aggregate_id = $1`,
        [orgId]
      )
      expect(outbox.rows).toHaveLength(0)
    })
  })

  // @spec INV-BILLING-009
  it('rejects dispute.closed with unknown status (fail-closed)', async () => {
    const { customer, orgId } = await seedOrgWithCustomer('unknown')
    const eventId = `evt_dispute_unknown_${uid}`

    const res = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      'dispute-closed-unknown-status',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(
          disputeClosedEvent(customer, eventId, { status: 'weird_unexpected_status' })
        )
      }
    )

    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance)
    })
  })

  // @spec INV-BILLING-009
  it('rejects lost dispute.closed with malformed amount instead of committing a zero deduction', async () => {
    const { customer, orgId } = await seedOrgWithCustomer('lost-bad-amount')
    const eventId = `evt_dispute_lost_bad_amount_${uid}`

    const res = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      'dispute-closed-lost-bad-amount',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify({
          id: eventId,
          type: 'charge.dispute.closed',
          data: {
            object: {
              id: `dp_${eventId}`,
              customer,
              status: 'lost',
              amount: 'not-a-number'
            }
          }
        })
      }
    )

    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance)

      const ledger = await client.query<{ id: string }>(
        'SELECT id FROM credit_ledger WHERE stripe_event_id = $1',
        [eventId]
      )
      expect(ledger.rows).toHaveLength(0)

      const outbox = await client.query<{ id: string }>(
        `SELECT id FROM domain_events
         WHERE event_type = 'billing.dispute_resolved' AND aggregate_id = $1`,
        [orgId]
      )
      expect(outbox.rows).toHaveLength(0)

      const claim = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM processed_stripe_events WHERE event_id = $1',
        [eventId]
      )
      expect(Number.parseInt(claim.rows[0]?.count ?? '0', 10)).toBe(0)
    })
  })

  // @spec INV-BILLING-009
  it("dispute.closed with status='won' releases the hold without deducting", async () => {
    const { customer, orgId } = await seedOrgWithCustomer('won')
    const eventId = `evt_dispute_won_${uid}`

    const res = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'dispute-closed-won',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(disputeClosedEvent(customer, eventId, { status: 'won' }))
      }
    )

    expect(res.response.status).toBe(200)
    expect(res.body.processed).toBe(true)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      // Won = no deduction, balance unchanged.
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance)

      const ledger = await client.query<{
        amount_decimillicents: string
        entry_type: string
      }>(
        'SELECT amount_decimillicents, entry_type FROM credit_ledger WHERE stripe_event_id = $1',
        [eventId]
      )
      // A zero-amount adjustment row lands as the audit trail for the resolution.
      expect(ledger.rows).toHaveLength(1)
      expect(ledger.rows[0]?.entry_type).toBe('adjustment')
      expect(Number(ledger.rows[0]?.amount_decimillicents)).toBe(0)

      const outbox = await client.query<{ payload: { outcome: 'won' | 'lost' } }>(
        `SELECT payload FROM domain_events
         WHERE event_type = 'billing.dispute_resolved' AND aggregate_id = $1`,
        [orgId]
      )
      expect(outbox.rows).toHaveLength(1)
      expect(outbox.rows[0]?.payload.outcome).toBe('won')
    })
  })

  // @spec INV-BILLING-009
  it("dispute.closed with status='warning_closed' treats inquiry as won (no deduction)", async () => {
    const { customer, orgId } = await seedOrgWithCustomer('warning')
    const eventId = `evt_dispute_warning_${uid}`

    const res = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'dispute-closed-warning-closed',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(
          disputeClosedEvent(customer, eventId, { status: 'warning_closed' })
        )
      }
    )

    expect(res.response.status).toBe(200)
    expect(res.body.processed).toBe(true)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance)

      const outbox = await client.query<{ payload: { outcome: 'won' | 'lost' } }>(
        `SELECT payload FROM domain_events
         WHERE event_type = 'billing.dispute_resolved' AND aggregate_id = $1`,
        [orgId]
      )
      expect(outbox.rows).toHaveLength(1)
      // Inquiries close as 'won' in our outbox payload vocabulary (no deduction).
      expect(outbox.rows[0]?.payload.outcome).toBe('won')
    })
  })

  // @spec INV-BILLING-009
  it('dispute.closed retry is idempotent under webhook redelivery', async () => {
    const { customer, orgId } = await seedOrgWithCustomer('retry')
    const eventId = `evt_dispute_retry_${uid}`
    const payload = JSON.stringify(
      disputeClosedEvent(customer, eventId, { status: 'lost', amount: 500 })
    )

    const first = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'dispute-closed-retry-1',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: payload
      }
    )
    expect(first.response.status).toBe(200)
    expect(first.body.idempotent).toBe(false)

    const second = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'dispute-closed-retry-2',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: payload
      }
    )
    expect(second.response.status).toBe(200)
    expect(second.body.idempotent).toBe(true)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const ledger = await client.query<{ id: string }>(
        'SELECT id FROM credit_ledger WHERE stripe_event_id = $1',
        [eventId]
      )
      // Exactly one ledger row survives redelivery.
      expect(ledger.rows).toHaveLength(1)

      const outbox = await client.query<{ id: string }>(
        `SELECT id FROM domain_events
         WHERE event_type = 'billing.dispute_resolved' AND aggregate_id = $1`,
        [orgId]
      )
      expect(outbox.rows).toHaveLength(1)

      // 500 cents = 50_000_000 decimillicents deducted from the seeded balance.
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance - 50_000_000)
    })
  })
})
