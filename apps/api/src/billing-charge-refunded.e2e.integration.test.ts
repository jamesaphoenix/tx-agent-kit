import { randomUUID } from 'node:crypto'
import {
  createOrganization,
  createUser,
  seedOrgCredits
} from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * `charge.refunded` webhook handler.
 *
 * Stripe emits `charge.refunded` when a charge is refunded (in full or
 * in part) — via the customer portal, the operator dashboard, or the
 * API. `amount_refunded` on the charge is CUMULATIVE across every
 * refund applied, so the delta for a specific event is
 * `amount_refunded - previous_attributes.amount_refunded`.
 *
 * Our handler:
 *   - Resolves the org via PaymentIntent metadata (commit 6df9235
 *     threads `organizationId` through) or via Stripe customer id.
 *   - Appends a negative `refund` ledger row for the delta.
 *   - Atomically emits `billing.credits_refunded`.
 *   - Is idempotent on `event.id` (duplicate deliveries no-op).
 *
 * @spec INV-BILLING-009
 * @spec INV-BILLING-010
 */

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_charge_refunded'
})

const baseBalance = 500_000_000 // $50

const seedOrgWithCustomer = async (suffix: string): Promise<{ orgId: string; customer: string }> => {
  const ctx = getFactoryContext()
  const owner = await createUser(ctx, {
    email: `charge-refunded-${suffix}-${uid}@example.com`,
    password: 'charge-refunded-pass-12345',
    name: `Refunded ${suffix} Owner`
  })
  const org = await createOrganization(ctx, {
    token: owner.token,
    name: `Refunded ${suffix} Org`
  })
  const customer = `cus_refund_${suffix}_${uid}`
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      'UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2',
      [customer, org.id]
    )
  })
  await seedOrgCredits(ctx, org.id, baseBalance)
  return { orgId: org.id, customer }
}

const chargeRefundedEvent = (
  customer: string,
  eventId: string,
  opts: {
    amountRefundedCents: number
    previousAmountRefundedCents?: number
    metadataOrgId?: string
  }
) => ({
  id: eventId,
  type: 'charge.refunded',
  data: {
    object: {
      id: `ch_${eventId}`,
      object: 'charge',
      customer,
      amount_refunded: opts.amountRefundedCents,
      ...(opts.metadataOrgId !== undefined
        ? { metadata: { organizationId: opts.metadataOrgId } }
        : {})
    },
    ...(opts.previousAmountRefundedCents !== undefined
      ? {
          previous_attributes: { amount_refunded: opts.previousAmountRefundedCents }
        }
      : {})
  }
})

describe('charge.refunded webhook handler', () => {
  // @spec INV-BILLING-009
  it('deducts the full amount on a first-time full refund', async () => {
    const { orgId, customer } = await seedOrgWithCustomer('full')
    const eventId = `evt_refund_full_${uid}`

    // $10 refund: 1000 cents = 100_000_000 decimillicents.
    const res = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      'refund-full',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(
          chargeRefundedEvent(customer, eventId, { amountRefundedCents: 1000 })
        )
      }
    )

    expect(res.response.status).toBe(200)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      // $50 - $10 = $40 remaining
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance - 100_000_000)

      const ledger = await client.query<{
        entry_type: string
        amount_decimillicents: string
        reason: string
      }>(
        `SELECT entry_type, amount_decimillicents::text, reason
         FROM credit_ledger
         WHERE stripe_event_id = $1`,
        [eventId]
      )
      expect(ledger.rows).toHaveLength(1)
      expect(ledger.rows[0]?.entry_type).toBe('refund')
      expect(Number(ledger.rows[0]?.amount_decimillicents)).toBe(-100_000_000)

      const outbox = await client.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM domain_events
         WHERE event_type = 'billing.credits_refunded' AND aggregate_id = $1`,
        [orgId]
      )
      expect(outbox.rows).toHaveLength(1)
      expect(outbox.rows[0]?.payload).toMatchObject({
        organizationId: orgId,
        amountDecimillicents: 100_000_000,
        stripeEventId: eventId
      })
    })
  })

  // @spec INV-BILLING-009
  // Partial refund on top of an earlier one: delta = cumulative - previous.
  it('deducts only the delta on a second partial refund', async () => {
    const { orgId, customer } = await seedOrgWithCustomer('partial')
    const eventId = `evt_refund_partial_${uid}`

    // Previous refund: $5 (500 cents). New cumulative: $8 (800 cents).
    // Delta should be $3 = 300 cents = 30_000_000 decimillicents.
    const res = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      'refund-partial',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(
          chargeRefundedEvent(customer, eventId, {
            amountRefundedCents: 800,
            previousAmountRefundedCents: 500
          })
        )
      }
    )

    expect(res.response.status).toBe(200)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance - 30_000_000)

      const ledger = await client.query<{ amount_decimillicents: string }>(
        `SELECT amount_decimillicents::text FROM credit_ledger WHERE stripe_event_id = $1`,
        [eventId]
      )
      expect(ledger.rows).toHaveLength(1)
      expect(Number(ledger.rows[0]?.amount_decimillicents)).toBe(-30_000_000)
    })
  })

  // @spec INV-BILLING-010 — billing consumers are idempotent.
  it('is idempotent on duplicate delivery of the same refund event', async () => {
    const { orgId, customer } = await seedOrgWithCustomer('idem')
    const eventId = `evt_refund_idem_${uid}`
    const body = JSON.stringify(
      chargeRefundedEvent(customer, eventId, { amountRefundedCents: 1000 })
    )

    const first = await request<{ message?: string }>('/v1/webhooks/stripe', 'refund-idem-1', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body
    })
    const second = await request<{ message?: string }>('/v1/webhooks/stripe', 'refund-idem-2', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body
    })

    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(200)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      // Balance deducted exactly once.
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance - 100_000_000)

      const ledger = await client.query<{ id: string }>(
        `SELECT id FROM credit_ledger WHERE stripe_event_id = $1`,
        [eventId]
      )
      expect(ledger.rows).toHaveLength(1)
    })
  })

  // @spec INV-BILLING-009 — ordering tolerance.
  // If `previous_attributes.amount_refunded` equals current, the
  // delta is zero and we should no-op without writing any rows.
  it('no-ops on a zero-delta event (cumulative == previous)', async () => {
    const { orgId, customer } = await seedOrgWithCustomer('noop')
    const eventId = `evt_refund_noop_${uid}`

    const res = await request<{ message?: string }>('/v1/webhooks/stripe', 'refund-noop', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(
        chargeRefundedEvent(customer, eventId, {
          amountRefundedCents: 1000,
          previousAmountRefundedCents: 1000
        })
      )
    })

    expect(res.response.status).toBe(200)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance)

      const ledger = await client.query<{ id: string }>(
        `SELECT id FROM credit_ledger WHERE stripe_event_id = $1`,
        [eventId]
      )
      expect(ledger.rows).toHaveLength(0)
    })
  })

  it('rejects malformed refund amounts instead of marking the Stripe event processed', async () => {
    const { customer } = await seedOrgWithCustomer('malformed')
    const eventId = `evt_refund_malformed_${uid}`

    const res = await request<{ message?: string }>('/v1/webhooks/stripe', 'refund-malformed', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        id: eventId,
        type: 'charge.refunded',
        data: {
          object: {
            id: `ch_${eventId}`,
            object: 'charge',
            customer
          }
        }
      })
    })

    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)

    const ctx = getFactoryContext()
    await ctx.testContext.withSchemaClient(async (client) => {
      const claim = await client.query<{ count: string }>(
        `SELECT count(*)::text
           FROM processed_stripe_events
          WHERE event_id = $1`,
        [eventId]
      )
      const ledger = await client.query<{ count: string }>(
        `SELECT count(*)::text
           FROM credit_ledger
          WHERE stripe_event_id = $1`,
        [eventId]
      )

      expect(Number.parseInt(claim.rows[0]?.count ?? '0', 10)).toBe(0)
      expect(Number.parseInt(ledger.rows[0]?.count ?? '0', 10)).toBe(0)
    })
  })

  // Org resolution via the metadata path (PaymentIntent metadata
  // propagation from commit 6df9235). When the charge's customer
  // isn't known to us but the metadata carries organizationId, the
  // handler should still process the refund.
  it('resolves the org via metadata.organizationId when customer is unknown', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `charge-refunded-meta-${uid}@example.com`,
      password: 'charge-refunded-pass-12345',
      name: 'Refunded Meta Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Refunded Meta Org'
    })
    await seedOrgCredits(ctx, org.id, baseBalance)
    // Deliberately do NOT set stripe_customer_id.
    const eventId = `evt_refund_meta_${uid}`

    const res = await request<{ message?: string }>('/v1/webhooks/stripe', 'refund-meta', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(
        chargeRefundedEvent(`cus_unknown_${uid}`, eventId, {
          amountRefundedCents: 500,
          metadataOrgId: org.id
        })
      )
    })

    expect(res.response.status).toBe(200)

    await ctx.testContext.withSchemaClient(async (client) => {
      const balance = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [org.id]
      )
      // $5 refund = 500 cents = 50_000_000 decimillicents
      expect(Number(balance.rows[0]?.credits_balance)).toBe(baseBalance - 50_000_000)
    })
  })
})
