import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './test-helpers.js'

/**
 * Concurrency stress test for the Stripe webhook handler.
 *
 * In production Stripe re-delivers a webhook on a 5/15/30/... minute
 * exponential backoff if the first response is non-2xx, but it can also
 * deliver retries within milliseconds when its own infrastructure
 * dedupes ambiguously (e.g. our LB scaling event causing a 502, the
 * webhook then arriving on two pods at once). The 3-layer idempotency
 * design (processed_stripe_events.tryInsert → subscription_events
 * unique → credit_ledger.stripe_event_id partial unique) must catch
 * EVERY race or we end up double-crediting an org.
 *
 * This test fires N copies of the same `checkout.session.completed`
 * payload at the API server in parallel and asserts that:
 *
 *   1. processed_stripe_events has exactly ONE row for the event id
 *   2. credit_ledger has exactly ONE 'purchase' row with that
 *      stripe_event_id (no double credit)
 *   3. Of the N HTTP responses, exactly ONE returned `idempotent: false`
 *      (the race winner) and the rest returned `idempotent: true`
 *   4. The amount on the single ledger row equals the spec'd value
 *
 * @spec INV-BILLING-005 — processed_stripe_events is the primary gate.
 * @spec INV-BILLING-009 — atomic ledger commit pattern.
 * @spec INV-BILLING-010 — billing consumers are idempotent.
 */

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'api_billing_webhook_concurrency'
})

describe('Stripe webhook concurrency', () => {
  // @spec INV-BILLING-005
  it('parallel duplicate checkout.session.completed deliveries grant credits exactly once', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `webhook-concurrency-owner-${uid}@example.com`,
      password: 'webhook-concurrency-pass-12345',
      name: 'Webhook Concurrency Owner'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Webhook Concurrency Org'
    })

    const eventId = `evt_concurrent_checkout_${uid}_${randomUUID().slice(0, 8)}`
    const checkoutPayload = {
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_concurrent_${uid}`,
          customer: `cus_concurrent_${uid}`,
          mode: 'payment',
          // $25 = 2500 cents = 250_000_000 decimillicents
          amount_total: 2500,
          payment_method: `pm_concurrent_${uid}`,
          metadata: { organizationId: organization.id }
        }
      }
    }

    // Fire 10 parallel deliveries of the same event.
    const N = 10
    const deliveries = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        request<{ processed: boolean; idempotent: boolean; eventId: string }>(
          '/v1/webhooks/stripe',
          `billing-webhook-concurrent-${uid}-${i.toString()}`,
          {
            method: 'POST',
            headers: { 'stripe-signature': 'integration-signature' },
            body: JSON.stringify(checkoutPayload)
          }
        )
      )
    )

    // All 10 responses MUST be 200. A single 500/4xx here would mean
    // the race somewhere in the 3-layer guard didn't degrade gracefully.
    for (const delivery of deliveries) {
      expect(delivery.response.status).toBe(200)
      expect(delivery.body.processed).toBe(true)
      expect(delivery.body.eventId).toBe(eventId)
    }

    // Exactly ONE delivery is the race winner (idempotent: false). The
    // rest must report idempotent: true.
    const winners = deliveries.filter((d) => !d.body.idempotent)
    const idempotents = deliveries.filter((d) => d.body.idempotent)
    expect(winners).toHaveLength(1)
    expect(idempotents).toHaveLength(N - 1)

    // Verify the database state is also exactly-once.
    await factoryContext.testContext.withSchemaClient(async (client) => {
      const processedRows = await client.query<{ event_id: string }>(
        'SELECT event_id FROM processed_stripe_events WHERE event_id = $1',
        [eventId]
      )
      expect(processedRows.rows).toHaveLength(1)

      const ledgerRows = await client.query<{
        amount_decimillicents: string
        entry_type: string
        stripe_event_id: string
      }>(
        `SELECT amount_decimillicents::text, entry_type, stripe_event_id
           FROM credit_ledger
          WHERE stripe_event_id = $1 AND organization_id = $2`,
        [eventId, organization.id]
      )
      expect(ledgerRows.rows).toHaveLength(1)
      expect(ledgerRows.rows[0]?.entry_type).toBe('purchase')
      expect(Number.parseInt(ledgerRows.rows[0]?.amount_decimillicents ?? '0', 10)).toBe(
        250_000_000
      )

      const subscriptionEventRows = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM subscription_events
          WHERE stripe_event_id = $1`,
        [eventId]
      )
      expect(Number.parseInt(subscriptionEventRows.rows[0]?.count ?? '0', 10)).toBe(1)
    })
  })

  // @spec INV-BILLING-005
  it('parallel duplicate customer.subscription.updated deliveries collapse to one subscription_events row', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `webhook-concurrency-sub-${uid}@example.com`,
      password: 'webhook-concurrency-sub-pass-12345',
      name: 'Webhook Concurrency Sub Owner'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Webhook Concurrency Sub Org'
    })

    const eventId = `evt_concurrent_sub_${uid}_${randomUUID().slice(0, 8)}`
    const subPayload = {
      id: eventId,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: `sub_concurrent_${uid}`,
          customer: `cus_concurrent_sub_${uid}`,
          status: 'active',
          start_date: Math.floor(Date.now() / 1000) - 100,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          metadata: { organizationId: organization.id },
          items: {
            data: [
              {
                id: `si_concurrent_${uid}`,
                price: { recurring: { usage_type: 'metered' } }
              }
            ]
          }
        }
      }
    }

    const N = 8
    const deliveries = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        request<{ processed: boolean; idempotent: boolean; eventId: string }>(
          '/v1/webhooks/stripe',
          `billing-webhook-concurrent-sub-${uid}-${i.toString()}`,
          {
            method: 'POST',
            headers: { 'stripe-signature': 'integration-signature' },
            body: JSON.stringify(subPayload)
          }
        )
      )
    )

    for (const delivery of deliveries) {
      expect(delivery.response.status).toBe(200)
      expect(delivery.body.processed).toBe(true)
    }
    const winners = deliveries.filter((d) => !d.body.idempotent)
    expect(winners).toHaveLength(1)

    await factoryContext.testContext.withSchemaClient(async (client) => {
      const subscriptionEventRows = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM subscription_events
          WHERE stripe_event_id = $1`,
        [eventId]
      )
      expect(Number.parseInt(subscriptionEventRows.rows[0]?.count ?? '0', 10)).toBe(1)

      const processedRows = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM processed_stripe_events
          WHERE event_id = $1`,
        [eventId]
      )
      expect(Number.parseInt(processedRows.rows[0]?.count ?? '0', 10)).toBe(1)
    })
  })
})
