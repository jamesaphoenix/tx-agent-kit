import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import {
  TOP_UP_MAX_DECIMILLICENTS,
  TOP_UP_MIN_DECIMILLICENTS
} from '@tx-agent-kit/contracts'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Bounds tests for `POST /v1/billing/:orgId/top-up`.
 *
 * The schema enforces 1 cent ≤ amountDecimillicents ≤ $500 and the
 * billing service has a defence-in-depth check at the service seam.
 * A fat-fingered UI bug (e.g. $1_000_000 passed without the decimal)
 * must NOT reach Stripe — it must surface as a typed 400 badRequest
 * so the frontend can show an actionable error instead of the user
 * seeing Stripe's generic error page after the checkout redirect.
 *
 * @spec billing-and-pricing-design §"Top-up bounds"
 */

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_topup_bounds'
})

const topUpBody = (amount: number) =>
  JSON.stringify({
    amountDecimillicents: amount,
    successUrl: 'https://app.example.com/billing/topup-success',
    cancelUrl: 'https://app.example.com/billing/topup-cancel'
  })

describe('top-up amount bounds', () => {
  // @spec billing-and-pricing-design §"Top-up bounds"
  it.each([
    ['missing amount_total', undefined],
    ['zero amount_total', 0],
    ['malformed amount_total', 'not-a-number'],
    ['above max amount_total', (TOP_UP_MAX_DECIMILLICENTS / 100_000) + 1],
    ['overflow amount_total', Number.MAX_SAFE_INTEGER]
  ])('rejects payment checkout webhook with %s before marking the Stripe event processed', async (_label, amountTotal) => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `topup-webhook-bounds-${_label.replaceAll(' ', '-')}-${uid}@example.com`,
      password: 'topup-webhook-bounds-pass-12345',
      name: 'Top Up Webhook Bounds Owner'
    })
    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: `Top Up Webhook Bounds ${_label}`
    })
    const customer = `cus_topup_webhook_bounds_${randomUUID().slice(0, 8)}`
    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        'UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2',
        [customer, org.id]
      )
    })

    const eventId = `evt_topup_webhook_bad_${randomUUID().slice(0, 8)}`
    const result = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      `topup-webhook-bounds-${_label}`,
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify({
          id: eventId,
          type: 'checkout.session.completed',
          data: {
            object: {
              id: `cs_topup_bad_${randomUUID().slice(0, 8)}`,
              customer,
              mode: 'payment',
              amount_total: amountTotal
            }
          }
        })
      }
    )

    expect(result.response.status).toBeGreaterThanOrEqual(400)
    expect(result.response.status).toBeLessThan(500)

    await factoryContext.testContext.withSchemaClient(async (client) => {
      const ledger = await client.query<{ id: string }>(
        'SELECT id FROM credit_ledger WHERE stripe_event_id = $1',
        [eventId]
      )
      expect(ledger.rows).toHaveLength(0)

      const outbox = await client.query<{ id: string }>(
        `SELECT id FROM domain_events
         WHERE event_type = 'billing.credits_purchased' AND aggregate_id = $1`,
        [org.id]
      )
      expect(outbox.rows).toHaveLength(0)

      const claim = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM processed_stripe_events WHERE event_id = $1',
        [eventId]
      )
      expect(Number.parseInt(claim.rows[0]?.count ?? '0', 10)).toBe(0)
    })
  })

  // @spec INV-BILLING-005
  it('rejects an invalid payment checkout webhook without partially mutating Stripe billing fields', async () => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `topup-webhook-partial-commit-${uid}@example.com`,
      password: 'topup-webhook-partial-commit-pass-12345',
      name: 'Top Up Webhook Partial Commit Owner'
    })
    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Top Up Webhook Partial Commit Org'
    })

    const eventId = `evt_topup_webhook_partial_${randomUUID().slice(0, 8)}`
    const result = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      'topup-webhook-partial-commit',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify({
          id: eventId,
          type: 'checkout.session.completed',
          data: {
            object: {
              id: `cs_topup_partial_${randomUUID().slice(0, 8)}`,
              customer: `cus_topup_partial_${randomUUID().slice(0, 8)}`,
              payment_method: `pm_topup_partial_${randomUUID().slice(0, 8)}`,
              subscription: `sub_topup_partial_${randomUUID().slice(0, 8)}`,
              mode: 'payment',
              amount_total: 'not-a-number',
              metadata: {
                organizationId: org.id,
                subscriptionPlan: 'pro'
              }
            }
          }
        })
      }
    )

    expect(result.response.status).toBeGreaterThanOrEqual(400)
    expect(result.response.status).toBeLessThan(500)

    await factoryContext.testContext.withSchemaClient(async (client) => {
      const billingFields = await client.query<{
        stripe_customer_id: string | null
        stripe_payment_method_id: string | null
        stripe_subscription_id: string | null
        subscription_plan: string | null
      }>(
        `SELECT
           stripe_customer_id,
           stripe_payment_method_id,
           stripe_subscription_id,
           subscription_plan
         FROM organizations
         WHERE id = $1`,
        [org.id]
      )
      expect(billingFields.rows[0]).toMatchObject({
        stripe_customer_id: null,
        stripe_payment_method_id: null,
        stripe_subscription_id: null,
        subscription_plan: null
      })

      const claim = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM processed_stripe_events WHERE event_id = $1',
        [eventId]
      )
      expect(Number.parseInt(claim.rows[0]?.count ?? '0', 10)).toBe(0)
    })
  })

  // @spec billing-and-pricing-design §"Top-up bounds"
  it('accepts the exact min ($0.01) and the exact max ($500)', async () => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `topup-bounds-valid-${uid}@example.com`,
      password: 'topup-bounds-valid-pass-12345',
      name: 'Top Up Bounds Valid Owner'
    })
    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Top Up Bounds Valid Org'
    })

    const minOutcome = await request<{ id: string; url: string }>(
      `/v1/billing/${org.id}/top-up`,
      'billing-topup-bounds-min',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}` },
        body: topUpBody(TOP_UP_MIN_DECIMILLICENTS)
      }
    )
    expect(minOutcome.response.status).toBe(200)
    expect(minOutcome.body.id).toMatch(/^cs_topup_local_/)

    const maxOutcome = await request<{ id: string; url: string }>(
      `/v1/billing/${org.id}/top-up`,
      'billing-topup-bounds-max',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}` },
        body: topUpBody(TOP_UP_MAX_DECIMILLICENTS)
      }
    )
    expect(maxOutcome.response.status).toBe(200)
    expect(maxOutcome.body.id).toMatch(/^cs_topup_local_/)
  })

  // @spec billing-and-pricing-design §"Top-up bounds"
  it('rejects amounts below the minimum with a 4xx', async () => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `topup-bounds-under-${uid}@example.com`,
      password: 'topup-bounds-under-pass-12345',
      name: 'Top Up Bounds Under Owner'
    })
    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Top Up Bounds Under Org'
    })

    const under = await request<{ message?: string; _tag?: string }>(
      `/v1/billing/${org.id}/top-up`,
      'billing-topup-bounds-under',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}` },
        body: topUpBody(TOP_UP_MIN_DECIMILLICENTS - 1)
      }
    )
    expect(under.response.status).toBeGreaterThanOrEqual(400)
    expect(under.response.status).toBeLessThan(500)
  })

  // @spec billing-and-pricing-design §"Top-up bounds"
  it('rejects zero and negative amounts', async () => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `topup-bounds-zero-${uid}@example.com`,
      password: 'topup-bounds-zero-pass-12345',
      name: 'Top Up Bounds Zero Owner'
    })
    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Top Up Bounds Zero Org'
    })

    for (const amount of [0, -1, -100_000]) {
      const outcome = await request<{ message?: string }>(
        `/v1/billing/${org.id}/top-up`,
        `billing-topup-bounds-zero-${amount.toString()}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${owner.token}` },
          body: topUpBody(amount)
        }
      )
      expect(outcome.response.status).toBeGreaterThanOrEqual(400)
      expect(outcome.response.status).toBeLessThan(500)
    }
  })

  // @spec billing-and-pricing-design §"Top-up bounds"
  it('rejects amounts above the $500 maximum', async () => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `topup-bounds-over-${uid}@example.com`,
      password: 'topup-bounds-over-pass-12345',
      name: 'Top Up Bounds Over Owner'
    })
    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Top Up Bounds Over Org'
    })

    // TOP_UP_MAX_DECIMILLICENTS + 1 decimillicent = one unit over the cap.
    const over = await request<{ message?: string }>(
      `/v1/billing/${org.id}/top-up`,
      'billing-topup-bounds-over',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}` },
        body: topUpBody(TOP_UP_MAX_DECIMILLICENTS + 1)
      }
    )
    expect(over.response.status).toBeGreaterThanOrEqual(400)
    expect(over.response.status).toBeLessThan(500)

    // A fat-fingered $1_000_000 (2000× the $500 cap) must ALSO be rejected.
    const wayOver = await request<{ message?: string }>(
      `/v1/billing/${org.id}/top-up`,
      'billing-topup-bounds-way-over',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}` },
        body: topUpBody(10_000_000_000_000)
      }
    )
    expect(wayOver.response.status).toBeGreaterThanOrEqual(400)
    expect(wayOver.response.status).toBeLessThan(500)
  })

  // @spec billing-and-pricing-design §"Top-up bounds"
  it('rejects non-integer decimillicents (fractional cents)', async () => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `topup-bounds-fractional-${uid}@example.com`,
      password: 'topup-bounds-fractional-pass-12345',
      name: 'Top Up Bounds Fractional Owner'
    })
    const org = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Top Up Bounds Fractional Org'
    })

    const outcome = await request<{ message?: string }>(
      `/v1/billing/${org.id}/top-up`,
      'billing-topup-bounds-fractional',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}` },
        body: topUpBody(100_000.5)
      }
    )
    expect(outcome.response.status).toBeGreaterThanOrEqual(400)
    expect(outcome.response.status).toBeLessThan(500)
  })
})
