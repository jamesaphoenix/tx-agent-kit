/**
 * Integration test for the no-bundled-credits invariant.
 *
 * Subscriptions in the flat-rate storage-only pricing model never grant
 * recurring AI credits on renewal. The only credits that arrive automatically
 * are the one-time welcome credit on the FIRST successful invoice payment
 * (covered by `billing-welcome-credit.e2e.integration.test.ts`). Every
 * subsequent renewal must be a credit-ledger no-op — no `purchase` entry,
 * no `adjustment` entry, no balance mutation.
 *
 * @spec INV-BILLING-NO-BUNDLED-CREDITS
 * @spec billing-and-pricing-design §"Plans"
 */
import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'api_no_bundled_credits'
})

type SubscriptionPlan = 'try_me' | 'pro' | 'agency'

const seedOrgWithWelcomeAlreadyGranted = async (
  label: string,
  plan: SubscriptionPlan
) => {
  const ctx = getFactoryContext()
  const owner = await createUser(ctx, {
    email: `nobundled-${label}-${uid}@example.com`,
    password: 'no-bundled-credits-pass-12345',
    name: `NoBundled ${label}`
  })
  const org = await createOrganization(ctx, {
    token: owner.token,
    name: `NoBundled ${label} Org`
  })
  const customer = `cus_nobundled_${label}_${uid}`
  const subscription = `sub_nobundled_${label}_${uid}`

  // Simulate a pre-existing welcome credit grant by directly setting
  // `welcome_credit_granted_at` to a past timestamp. This sidesteps the
  // entire welcome-credit branch of the webhook handler, so any ledger
  // writes we observe in the test come exclusively from the "bundled
  // credits" pathway (which must not exist).
  await ctx.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations
          SET stripe_customer_id = $1,
              stripe_subscription_id = $2,
              subscription_plan = $3,
              subscription_status = 'active',
              is_subscribed = true,
              welcome_credit_granted_at = now() - interval '30 days'
        WHERE id = $4`,
      [customer, subscription, plan, org.id]
    )
  })

  return { ctx, owner, org, customer, subscription }
}

const renewalInvoicePaymentSucceededEvent = (
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

describe('no bundled credits on subscription renewal [INV-BILLING-NO-BUNDLED-CREDITS]', () => {
  const assertRenewalIsLedgerNoop = async (plan: SubscriptionPlan, label: string) => {
    const { ctx, org, customer, subscription } = await seedOrgWithWelcomeAlreadyGranted(label, plan)

    // Capture pre-state: welcome credit granted long ago, zero ledger rows
    // (since we set the column directly without writing a ledger entry).
    const beforeLedgerCount = await ctx.testContext.withSchemaClient(async (client) => {
      const r = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM credit_ledger WHERE organization_id = $1`,
        [org.id]
      )
      return Number(r.rows[0]?.count ?? '0')
    })
    expect(beforeLedgerCount).toBe(0)

    const beforeBalance = await ctx.testContext.withSchemaClient(async (client) => {
      const r = await client.query<{ credits_balance: string }>(
        `SELECT credits_balance FROM organizations WHERE id = $1`,
        [org.id]
      )
      return Number(r.rows[0]?.credits_balance ?? '0')
    })

    // Fire a renewal invoice.payment_succeeded.
    const eventId = `evt_renewal_${plan}_${uid}`
    const res = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      `nobundled-renewal-${plan}`,
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(
          renewalInvoicePaymentSucceededEvent(customer, subscription, eventId, org.id)
        )
      }
    )
    expect(res.response.status).toBe(200)

    // POST-state: ledger still empty, balance unchanged.
    await ctx.testContext.withSchemaClient(async (client) => {
      const afterLedger = await client.query<{ count: string; entry_type: string | null; reason: string | null }>(
        `SELECT COUNT(*)::text AS count,
                MAX(entry_type) AS entry_type,
                MAX(reason) AS reason
           FROM credit_ledger
          WHERE organization_id = $1`,
        [org.id]
      )
      const afterCount = Number(afterLedger.rows[0]?.count ?? '0')
      expect(afterCount).toBe(0)

      const afterBalance = await client.query<{ credits_balance: string }>(
        `SELECT credits_balance FROM organizations WHERE id = $1`,
        [org.id]
      )
      expect(Number(afterBalance.rows[0]?.credits_balance)).toBe(beforeBalance)

      // Extra belt-and-suspenders: there must be no `billing.welcome_credit_granted`
      // outbox event for this renewal, and no `billing.credits_purchased` event.
      const events = await client.query<{ event_type: string }>(
        `SELECT event_type FROM domain_events
          WHERE aggregate_id = $1
            AND event_type IN ('billing.welcome_credit_granted', 'billing.credits_purchased')`,
        [org.id]
      )
      expect(events.rows).toHaveLength(0)
    })
  }

  it('Try Me renewal does NOT grant bundled credits', async () => {
    await assertRenewalIsLedgerNoop('try_me', 'tryme')
  })

  it('Pro renewal does NOT grant bundled credits [INV-REQ-BILLING-AND-PRICING-005]', async () => {
    await assertRenewalIsLedgerNoop('pro', 'pro')
  })

  it('Agency renewal does NOT grant bundled credits', async () => {
    await assertRenewalIsLedgerNoop('agency', 'agency')
  })

  it('Ten consecutive renewals leave the ledger empty', async () => {
    const { ctx, org, customer, subscription } = await seedOrgWithWelcomeAlreadyGranted('repeat', 'pro')

    for (let i = 0; i < 10; i += 1) {
      const eventId = `evt_repeat_${i}_${uid}`
      const res = await request(
        '/v1/webhooks/stripe',
        `nobundled-repeat-${i}`,
        {
          method: 'POST',
          headers: { 'stripe-signature': 'integration-signature' },
          body: JSON.stringify(
            renewalInvoicePaymentSucceededEvent(customer, subscription, eventId, org.id)
          )
        }
      )
      expect(res.response.status).toBe(200)
    }

    await ctx.testContext.withSchemaClient(async (client) => {
      const r = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM credit_ledger WHERE organization_id = $1`,
        [org.id]
      )
      expect(Number(r.rows[0]?.count ?? '0')).toBe(0)

      const balance = await client.query<{ credits_balance: string }>(
        `SELECT credits_balance FROM organizations WHERE id = $1`,
        [org.id]
      )
      expect(Number(balance.rows[0]?.credits_balance)).toBe(0)
    })
  })
})
