/**
 * Integration tests for the welcome credit grant on first successful
 * subscription charge.
 *
 * @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
 * @spec INV-BILLING-CREDITS-NEVER-EXPIRE
 * @spec INV-BILLING-NO-BUNDLED-CREDITS
 *
 * Decisions encoded:
 *   - Try Me grants $9 = 90_000_000 decimillicents
 *   - Pro grants $20 = 200_000_000 decimillicents
 *   - Agency grants $45 = 450_000_000 decimillicents
 *   - Grant triggers on first successful invoice.payment_succeeded only
 *   - organizations.welcome_credit_granted_at is the one-time guard
 *   - ledger entry: { entryType: 'adjustment', reason: 'welcome_credit' }
 *   - outbox event: billing.welcome_credit_granted (atomic with ledger write)
 *   - Refund forgiveness: charge.refunded never claws back welcome credit
 */
import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'api_welcome_credit'
})

const WELCOME_TRY_ME_DECIMILLICENTS = 90_000_000
const WELCOME_PRO_DECIMILLICENTS = 200_000_000
const WELCOME_AGENCY_DECIMILLICENTS = 450_000_000

type SubscriptionPlan = 'try_me' | 'pro' | 'agency'

const seedOrgWithSubscription = async (
  label: string,
  plan: SubscriptionPlan
) => {
  const ctx = getFactoryContext()
  const owner = await createUser(ctx, {
    email: `welcome-${label}-${uid}@example.com`,
    password: 'welcome-credit-pass-12345',
    name: `Welcome ${label}`
  })
  const org = await createOrganization(ctx, {
    token: owner.token,
    name: `Welcome ${label} Org`
  })
  const customer = `cus_welcome_${label}_${uid}`
  const subscription = `sub_welcome_${label}_${uid}`
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations
          SET stripe_customer_id = $1,
              stripe_subscription_id = $2,
              subscription_plan = $3,
              subscription_status = 'active',
              is_subscribed = true
        WHERE id = $4`,
      [customer, subscription, plan, org.id]
    )
  })
  return { ctx, owner, org, customer, subscription }
}

const invoicePaymentSucceededEvent = (
  customer: string,
  subscription: string,
  eventId: string,
  organizationId: string
) => ({
  id: eventId,
  type: 'invoice.payment_succeeded',
  data: {
    object: {
      id: `in_${eventId}`,
      customer,
      subscription,
      metadata: { organizationId }
    }
  }
})

describe('welcome credit grant [INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG]', () => {
  it('grants Try Me welcome credit ($9) on first invoice.payment_succeeded', async () => {
    const { ctx, org, customer, subscription } = await seedOrgWithSubscription('trymefirst', 'try_me')
    const eventId = `evt_welcome_tryme_${uid}`

    const res = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'welcome-tryme-first',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(
          invoicePaymentSucceededEvent(customer, subscription, eventId, org.id)
        )
      }
    )

    expect(res.response.status).toBe(200)
    expect(res.body.processed).toBe(true)

    await ctx.testContext.withSchemaClient(async (client) => {
      const orgRow = await client.query<{
        welcome_credit_granted_at: Date | null
        credits_balance: string
      }>(
        `SELECT welcome_credit_granted_at, credits_balance FROM organizations WHERE id = $1`,
        [org.id]
      )
      expect(orgRow.rows[0]?.welcome_credit_granted_at).not.toBeNull()
      expect(Number(orgRow.rows[0]?.credits_balance)).toBe(WELCOME_TRY_ME_DECIMILLICENTS)

      const ledger = await client.query<{
        entry_type: string
        amount_decimillicents: string
        reason: string
      }>(
        `SELECT entry_type, amount_decimillicents::text, reason
         FROM credit_ledger
         WHERE organization_id = $1 AND reason = 'welcome_credit'`,
        [org.id]
      )
      expect(ledger.rows).toHaveLength(1)
      expect(ledger.rows[0]?.entry_type).toBe('adjustment')
      expect(Number(ledger.rows[0]?.amount_decimillicents)).toBe(WELCOME_TRY_ME_DECIMILLICENTS)

      const events = await client.query<{
        event_type: string
        payload: { organizationId: string; amountDecimillicents: number; plan: string }
      }>(
        `SELECT event_type, payload FROM domain_events
         WHERE aggregate_id = $1 AND event_type = 'billing.welcome_credit_granted'`,
        [org.id]
      )
      expect(events.rows).toHaveLength(1)
      expect(events.rows[0]?.payload.amountDecimillicents).toBe(WELCOME_TRY_ME_DECIMILLICENTS)
      expect(events.rows[0]?.payload.plan).toBe('try_me')
    })
  })

  it('grants Pro welcome credit ($20) for Pro subscribers', async () => {
    const { ctx, org, customer, subscription } = await seedOrgWithSubscription('profirst', 'pro')
    const eventId = `evt_welcome_pro_${uid}`

    const res = await request('/v1/webhooks/stripe', 'welcome-pro-first', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(
        invoicePaymentSucceededEvent(customer, subscription, eventId, org.id)
      )
    })
    expect(res.response.status).toBe(200)

    await ctx.testContext.withSchemaClient(async (client) => {
      const orgRow = await client.query<{ credits_balance: string }>(
        `SELECT credits_balance FROM organizations WHERE id = $1`,
        [org.id]
      )
      expect(Number(orgRow.rows[0]?.credits_balance)).toBe(WELCOME_PRO_DECIMILLICENTS)
    })
  })

  it('fails closed when invoice.payment_succeeded arrives before the subscription row is linked, then grants on retry', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `welcome-out-of-order-${uid}@example.com`,
      password: 'welcome-credit-pass-12345',
      name: 'Welcome Out Of Order'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Welcome Out Of Order Org'
    })
    const customer = `cus_welcome_out_of_order_${uid}`
    const subscription = `sub_welcome_out_of_order_${uid}`
    const invoiceEventId = `evt_welcome_out_of_order_invoice_${uid}`
    const invoiceBody = JSON.stringify(
      invoicePaymentSucceededEvent(customer, subscription, invoiceEventId, org.id)
    )

    const firstInvoiceAttempt = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      'welcome-out-of-order-invoice-first',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: invoiceBody
      }
    )

    expect(firstInvoiceAttempt.response.status).toBeGreaterThanOrEqual(400)
    expect(firstInvoiceAttempt.response.status).toBeLessThan(500)

    await ctx.testContext.withSchemaClient(async (client) => {
      const claim = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM processed_stripe_events WHERE event_id = $1',
        [invoiceEventId]
      )
      expect(Number.parseInt(claim.rows[0]?.count ?? '0', 10)).toBe(0)

      const orgRow = await client.query<{
        credits_balance: string
        welcome_credit_granted_at: Date | null
        stripe_subscription_id: string | null
        subscription_plan: string | null
      }>(
        `SELECT
           credits_balance,
           welcome_credit_granted_at,
           stripe_subscription_id,
           subscription_plan
         FROM organizations
         WHERE id = $1`,
        [org.id]
      )
      expect(Number(orgRow.rows[0]?.credits_balance)).toBe(0)
      expect(orgRow.rows[0]?.welcome_credit_granted_at).toBeNull()
      expect(orgRow.rows[0]?.stripe_subscription_id).toBeNull()
      expect(orgRow.rows[0]?.subscription_plan).toBeNull()
    })

    const subscriptionWebhook = await request(
      '/v1/webhooks/stripe',
      'welcome-out-of-order-subscription-created',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify({
          id: `evt_welcome_out_of_order_subscription_${uid}`,
          type: 'customer.subscription.created',
          data: {
            object: {
              id: subscription,
              customer,
              status: 'active',
              current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
              metadata: {
                organizationId: org.id,
                subscriptionPlan: 'pro'
              }
            }
          }
        })
      }
    )
    expect(subscriptionWebhook.response.status).toBe(200)

    const retryInvoiceAttempt = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'welcome-out-of-order-invoice-retry',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: invoiceBody
      }
    )
    expect(retryInvoiceAttempt.response.status).toBe(200)
    expect(retryInvoiceAttempt.body.processed).toBe(true)
    expect(retryInvoiceAttempt.body.idempotent).toBe(false)

    await ctx.testContext.withSchemaClient(async (client) => {
      const orgRow = await client.query<{
        credits_balance: string
        welcome_credit_granted_at: Date | null
      }>(
        `SELECT credits_balance, welcome_credit_granted_at
         FROM organizations
         WHERE id = $1`,
        [org.id]
      )
      expect(Number(orgRow.rows[0]?.credits_balance)).toBe(WELCOME_PRO_DECIMILLICENTS)
      expect(orgRow.rows[0]?.welcome_credit_granted_at).not.toBeNull()

      const ledger = await client.query<{ id: string }>(
        `SELECT id
         FROM credit_ledger
         WHERE organization_id = $1 AND reason = 'welcome_credit'`,
        [org.id]
      )
      expect(ledger.rows).toHaveLength(1)
    })
  })

  it('grants Agency welcome credit ($45) for Agency subscribers', async () => {
    const { ctx, org, customer, subscription } = await seedOrgWithSubscription('agencyfirst', 'agency')
    const eventId = `evt_welcome_agency_${uid}`

    const res = await request('/v1/webhooks/stripe', 'welcome-agency-first', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(
        invoicePaymentSucceededEvent(customer, subscription, eventId, org.id)
      )
    })
    expect(res.response.status).toBe(200)

    await ctx.testContext.withSchemaClient(async (client) => {
      const orgRow = await client.query<{ credits_balance: string }>(
        `SELECT credits_balance FROM organizations WHERE id = $1`,
        [org.id]
      )
      expect(Number(orgRow.rows[0]?.credits_balance)).toBe(WELCOME_AGENCY_DECIMILLICENTS)
    })
  })

  // @spec INV-BILLING-NO-BUNDLED-CREDITS — renewals MUST NOT grant more credits
  it('does NOT re-grant on a second invoice.payment_succeeded (renewal)', async () => {
    const { ctx, org, customer, subscription } = await seedOrgWithSubscription('renewal', 'pro')
    const firstEvent = `evt_welcome_renew_1_${uid}`
    const secondEvent = `evt_welcome_renew_2_${uid}`

    await request('/v1/webhooks/stripe', 'welcome-renew-1', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(
        invoicePaymentSucceededEvent(customer, subscription, firstEvent, org.id)
      )
    })

    await request('/v1/webhooks/stripe', 'welcome-renew-2', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(
        invoicePaymentSucceededEvent(customer, subscription, secondEvent, org.id)
      )
    })

    await ctx.testContext.withSchemaClient(async (client) => {
      const orgRow = await client.query<{ credits_balance: string }>(
        `SELECT credits_balance FROM organizations WHERE id = $1`,
        [org.id]
      )
      // Balance is still just the single welcome credit — renewal granted nothing
      expect(Number(orgRow.rows[0]?.credits_balance)).toBe(WELCOME_PRO_DECIMILLICENTS)

      const ledger = await client.query<{ id: string }>(
        `SELECT id FROM credit_ledger WHERE organization_id = $1 AND reason = 'welcome_credit'`,
        [org.id]
      )
      expect(ledger.rows).toHaveLength(1)
    })
  })

  it('is idempotent under concurrent webhook retry of the same event', async () => {
    const { ctx, org, customer, subscription } = await seedOrgWithSubscription('idem', 'pro')
    const eventId = `evt_welcome_idem_${uid}`
    const body = JSON.stringify(
      invoicePaymentSucceededEvent(customer, subscription, eventId, org.id)
    )

    const [first, second] = await Promise.all([
      request('/v1/webhooks/stripe', 'welcome-idem-1', {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body
      }),
      request('/v1/webhooks/stripe', 'welcome-idem-2', {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body
      })
    ])

    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(200)

    await ctx.testContext.withSchemaClient(async (client) => {
      const ledger = await client.query<{ id: string }>(
        `SELECT id FROM credit_ledger WHERE organization_id = $1 AND reason = 'welcome_credit'`,
        [org.id]
      )
      expect(ledger.rows).toHaveLength(1)
    })
  })

  // @spec INV-BILLING-CREDITS-NEVER-EXPIRE — welcome credits are forgiven on refund
  it('does NOT claw back the welcome credit when the charge is refunded', async () => {
    const { ctx, org, customer, subscription } = await seedOrgWithSubscription('refund', 'pro')
    const chargeEvent = `evt_welcome_refund_charge_${uid}`
    const refundEvent = `evt_welcome_refund_refund_${uid}`

    await request('/v1/webhooks/stripe', 'welcome-refund-charge', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(
        invoicePaymentSucceededEvent(customer, subscription, chargeEvent, org.id)
      )
    })

    // Subscription refunds carry an `invoice` reference (the charge was
    // created by a Stripe Invoice, not a standalone PaymentIntent). The
    // handler uses that field to distinguish subscription refunds (forgiven)
    // from top-up/auto-recharge refunds (debited).
    const refundPayload = {
      id: refundEvent,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${refundEvent}`,
          customer,
          invoice: `in_sub_${uid}`,
          amount: 4900,
          amount_refunded: 4900,
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'welcome-refund-refund', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(refundPayload)
    })

    await ctx.testContext.withSchemaClient(async (client) => {
      // Welcome credit ledger entry remains untouched — refund handler must
      // filter reason='welcome_credit' out of the clawback calculation.
      const welcomeLedger = await client.query<{ amount_decimillicents: string }>(
        `SELECT amount_decimillicents::text FROM credit_ledger
         WHERE organization_id = $1 AND reason = 'welcome_credit'`,
        [org.id]
      )
      expect(welcomeLedger.rows).toHaveLength(1)
      expect(Number(welcomeLedger.rows[0]?.amount_decimillicents)).toBe(WELCOME_PRO_DECIMILLICENTS)

      // Balance still holds the full welcome credit.
      const orgRow = await client.query<{ credits_balance: string }>(
        `SELECT credits_balance FROM organizations WHERE id = $1`,
        [org.id]
      )
      expect(Number(orgRow.rows[0]?.credits_balance)).toBe(WELCOME_PRO_DECIMILLICENTS)
    })
  })
})
