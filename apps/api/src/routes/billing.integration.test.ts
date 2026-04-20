import { randomUUID } from 'node:crypto'
import { createDbAuthContext, createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import {
  apiCwd,
  createTestFixture,
  integrationAuthSecret
} from './test-helpers.js'

const uid = randomUUID().slice(0, 8)
const stripeId = (value: string): string => `${value}_${uid}`

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'api_billing'
})

// 23 tests, API-route integration — each test uses a unique email prefix
// (billing-authz-owner / billing-topup-owner / webhook-owner / …) and its
// own createUser / createOrganization, so there's no cross-test collision
// on the shared integration API server. Flip to describe.concurrent so
// the HTTP round-trips interleave instead of serialising on the worker.
describe.concurrent('billing integration', () => {
  it('enforces billing authorization for unauthenticated, non-member, and member callers', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `billing-authz-owner-${uid}@example.com`,
      password: 'billing-authz-owner-pass-12345',
      name: 'Billing Authz Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Authz Team'
    })

    const periodStart = new Date(Date.now() - (1000 * 60 * 60 * 24)).toISOString()
    const periodEnd = new Date(Date.now() + (1000 * 60 * 60 * 24)).toISOString()

    const unauthenticatedGet = await request<{ message: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-unauth-get',
      {
        method: 'GET'
      }
    )
    expect(unauthenticatedGet.response.status).toBe(401)

    const unauthenticatedUpdate = await request<{ message: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-unauth-update',
      {
        method: 'PATCH',
        body: JSON.stringify({
          autoRechargeEnabled: true,
          autoRechargeThresholdDecimillicents: 100_000,
          autoRechargeAmountDecimillicents: 500_000
        })
      }
    )
    expect(unauthenticatedUpdate.response.status).toBe(401)

    const unauthenticatedCheckout = await request<{ message: string }>(
      '/v1/billing/checkout',
      'billing-authz-unauth-checkout',
      {
        method: 'POST',
        body: JSON.stringify({
          organizationId: organization.id,
          subscriptionPlan: 'pro',
          successUrl: 'https://app.example.com/billing/success',
          cancelUrl: 'https://app.example.com/billing/cancel'
        })
      }
    )
    expect(unauthenticatedCheckout.response.status).toBe(401)

    const unauthenticatedPortal = await request<{ message: string }>(
      '/v1/billing/portal',
      'billing-authz-unauth-portal',
      {
        method: 'POST',
        body: JSON.stringify({
          organizationId: organization.id,
          returnUrl: 'https://app.example.com/billing'
        })
      }
    )
    expect(unauthenticatedPortal.response.status).toBe(401)

    const unauthenticatedUsage = await request<{ message: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'billing-authz-unauth-usage',
      {
        method: 'GET'
      }
    )
    expect(unauthenticatedUsage.response.status).toBe(401)

    const outsider = await createUser(factoryContext, {
      email: `billing-authz-outsider-${uid}@example.com`,
      password: 'billing-authz-outsider-pass-12345',
      name: 'Billing Authz Outsider'
    })

    const outsiderGet = await request<{ message: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-outsider-get',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${outsider.token}`
        }
      }
    )
    expect(outsiderGet.response.status).toBe(401)

    const outsiderUsage = await request<{ message: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'billing-authz-outsider-usage',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${outsider.token}`
        }
      }
    )
    expect(outsiderUsage.response.status).toBe(401)

    const member = await createUser(factoryContext, {
      email: `billing-authz-member-${uid}@example.com`,
      password: 'billing-authz-member-pass-12345',
      name: 'Billing Authz Member'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO org_members (organization_id, user_id, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT (organization_id, user_id) DO NOTHING
        `,
        [organization.id, member.user.id]
      )
    })

    const memberGet = await request<{ organizationId: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-member-get',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )
    expect(memberGet.response.status).toBe(200)
    expect(memberGet.body.organizationId).toBe(organization.id)

    const memberUpdate = await request<{ message: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-authz-member-update',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          autoRechargeEnabled: true,
          autoRechargeThresholdDecimillicents: 100_000,
          autoRechargeAmountDecimillicents: 500_000
        })
      }
    )
    expect(memberUpdate.response.status).toBe(401)

    const memberCheckout = await request<{ message: string }>(
      '/v1/billing/checkout',
      'billing-authz-member-checkout',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          subscriptionPlan: 'pro',
          successUrl: 'https://app.example.com/billing/success',
          cancelUrl: 'https://app.example.com/billing/cancel'
        })
      }
    )
    expect(memberCheckout.response.status).toBe(401)

    const memberPortal = await request<{ message: string }>(
      '/v1/billing/portal',
      'billing-authz-member-portal',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          returnUrl: 'https://app.example.com/billing'
        })
      }
    )
    expect(memberPortal.response.status).toBe(401)
  })

  it('supports billing settings and checkout/portal flows', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `billing-owner-${uid}@example.com`,
      password: 'billing-owner-pass-12345',
      name: 'Billing Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Team'
    })

    const getBilling = await request<{ organizationId: string; autoRechargeEnabled: boolean }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-get-settings',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(getBilling.response.status).toBe(200)
    expect(getBilling.body.organizationId).toBe(organization.id)

    const updateBilling = await request<{
      autoRechargeEnabled: boolean
      autoRechargeThresholdDecimillicents: number | null
      autoRechargeAmountDecimillicents: number | null
    }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-update-settings',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          autoRechargeEnabled: true,
          autoRechargeThresholdDecimillicents: 500_000,
          autoRechargeAmountDecimillicents: 2_000_000
        })
      }
    )

    expect(updateBilling.response.status).toBe(200)
    expect(updateBilling.body.autoRechargeEnabled).toBe(true)
    expect(updateBilling.body.autoRechargeThresholdDecimillicents).toBe(500_000)
    expect(updateBilling.body.autoRechargeAmountDecimillicents).toBe(2_000_000)

    const checkout = await request<{ id: string; url: string }>(
      '/v1/billing/checkout',
      'billing-checkout',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          subscriptionPlan: 'pro',
          successUrl: 'https://app.example.com/billing/success',
          cancelUrl: 'https://app.example.com/billing/cancel'
        })
      }
    )

    expect(checkout.response.status).toBe(200)
    expect(checkout.body.id.length).toBeGreaterThan(0)
    expect(checkout.body.url.length).toBeGreaterThan(0)

    const portal = await request<{ id: string; url: string }>(
      '/v1/billing/portal',
      'billing-portal',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          returnUrl: 'https://app.example.com/billing'
        })
      }
    )

    expect(portal.response.status).toBe(200)
    expect(portal.body.id.length).toBeGreaterThan(0)
    expect(portal.body.url.length).toBeGreaterThan(0)
  })

  it('creates a one-time top-up Stripe Checkout session for authenticated org admins', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `billing-topup-owner-${uid}@example.com`,
      password: 'billing-topup-owner-pass-12345',
      name: 'Billing Top-Up Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Top-Up Org'
    })

    const topUp = await request<{ id: string; url: string }>(
      `/v1/billing/${organization.id}/top-up`,
      'billing-topup',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          amountDecimillicents: 50_000_000, // $5.00
          successUrl: 'https://app.example.com/billing/topup-success',
          cancelUrl: 'https://app.example.com/billing/topup-cancel'
        })
      }
    )

    expect(topUp.response.status).toBe(200)
    expect(topUp.body.id.length).toBeGreaterThan(0)
    expect(topUp.body.url.length).toBeGreaterThan(0)
    // Local Stripe stub in apps/api/src/adapters/stripe.ts returns an id
    // of the form `cs_topup_local_<uuid>` when no real Stripe client is
    // configured — the integration harness runs without STRIPE_SECRET_KEY
    // so this is the expected happy-path in tests.
    expect(topUp.body.id).toMatch(/^cs_topup_local_/)
  })

  it('rejects top-up requests from non-members with 401', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `billing-topup-reject-owner-${uid}@example.com`,
      password: 'billing-topup-reject-owner-pass-12345',
      name: 'Billing Top-Up Reject Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Top-Up Reject Org'
    })

    const outsider = await createUser(factoryContext, {
      email: `billing-topup-reject-outsider-${uid}@example.com`,
      password: 'billing-topup-reject-outsider-pass-12345',
      name: 'Billing Top-Up Reject Outsider'
    })

    const outsiderTopUp = await request<{ message?: string }>(
      `/v1/billing/${organization.id}/top-up`,
      'billing-topup-outsider',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${outsider.token}`
        },
        body: JSON.stringify({
          amountDecimillicents: 50_000_000,
          successUrl: 'https://app.example.com/billing/topup-success',
          cancelUrl: 'https://app.example.com/billing/topup-cancel'
        })
      }
    )

    expect(outsiderTopUp.response.status).toBe(401)
  })

  it('creates a Stripe customer before opening the billing portal when none is configured', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `billing-portal-no-customer-owner-${uid}@example.com`,
      password: 'billing-portal-no-customer-pass-12345',
      name: 'Billing Portal No Customer Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Portal No Customer Team'
    })

    const portal = await request<{ id: string; url: string }>(
      '/v1/billing/portal',
      'billing-portal-no-customer',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          returnUrl: 'https://app.example.com/billing'
        })
      }
    )

    expect(portal.response.status).toBe(200)
    expect(portal.body.id.length).toBeGreaterThan(0)
    expect(portal.body.url).toBe('https://app.example.com/billing')

    const billingSettings = await request<{ stripeCustomerId: string | null }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-portal-created-customer-settings',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(billingSettings.body.stripeCustomerId).toBe(`cus_local_${organization.id}`)
  })

  it('rejects usage summaries with invalid date query parameters', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `billing-invalid-usage-date-owner-${uid}@example.com`,
      password: 'billing-invalid-usage-date-pass-12345',
      name: 'Billing Invalid Usage Date Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing Invalid Usage Date Team'
    })

    const invalidDate = await request<{ message?: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=not-a-date&periodEnd=${encodeURIComponent(new Date().toISOString())}`,
      'billing-usage-invalid-date',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(invalidDate.response.status).toBe(400)
    expect(invalidDate.body.message ?? '').toContain('Invalid periodStart date')

    const periodStart = new Date(Date.now() + (1000 * 60 * 60)).toISOString()
    const periodEnd = new Date().toISOString()

    const invalidRange = await request<{ message?: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'billing-usage-invalid-range',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(invalidRange.response.status).toBe(400)
    expect(invalidRange.body.message ?? '').toContain('periodEnd must be >= periodStart')
  })

  it('rejects Stripe webhooks that omit the signature header', async () => {
    const webhook = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      'billing-webhook-missing-signature',
      {
        method: 'POST',
        body: JSON.stringify({
          id: stripeId('evt_missing_signature'),
          type: 'invoice.payment_succeeded',
          data: { object: {} }
        })
      }
    )

    expect(webhook.response.status).toBe(400)
    expect(webhook.body.message ?? '').toContain('Missing stripe-signature header')
  })

  it('processes stripe webhooks idempotently and syncs subscription state [INV-REQ-BILLING-AND-PRICING-009]', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `webhook-owner-${uid}@example.com`,
      password: 'webhook-owner-pass-12345',
      name: 'Webhook Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Webhook Team'
    })

    const webhookPayload = {
      id: stripeId('evt_subscription_sync_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_sync_1'),
          customer: stripeId('cus_sync_1'),
          status: 'active',
          start_date: Math.floor(Date.now() / 1000) - 100,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          metadata: {
            organizationId: organization.id
          },
          items: {
            data: [
              {
                id: stripeId('si_metered_sync_1'),
                price: {
                  recurring: {
                    usage_type: 'metered'
                  }
                }
              }
            ]
          }
        }
      }
    }

    const firstWebhook = await request<{ processed: boolean; idempotent: boolean; eventId: string }>(
      '/v1/webhooks/stripe',
      'billing-webhook-first',
      {
        method: 'POST',
        headers: {
          'stripe-signature': 'integration-signature'
        },
        body: JSON.stringify(webhookPayload)
      }
    )

    expect(firstWebhook.response.status).toBe(200)
    expect(firstWebhook.body.processed).toBe(true)
    expect(firstWebhook.body.idempotent).toBe(false)

    const secondWebhook = await request<{ processed: boolean; idempotent: boolean; eventId: string }>(
      '/v1/webhooks/stripe',
      'billing-webhook-second',
      {
        method: 'POST',
        headers: {
          'stripe-signature': 'integration-signature'
        },
        body: JSON.stringify(webhookPayload)
      }
    )

    expect(secondWebhook.response.status).toBe(200)
    expect(secondWebhook.body.processed).toBe(true)
    expect(secondWebhook.body.idempotent).toBe(true)

    const billingSettings = await request<{
      isSubscribed: boolean
      subscriptionStatus: string
      stripeSubscriptionId: string | null
      stripeMeteredSubscriptionItemId: string | null
    }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-settings-after-webhook',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(billingSettings.response.status).toBe(200)
    expect(billingSettings.body.isSubscribed).toBe(true)
    expect(billingSettings.body.subscriptionStatus).toBe('active')
    expect(billingSettings.body.stripeSubscriptionId).toBe(stripeId('sub_sync_1'))
    expect(billingSettings.body.stripeMeteredSubscriptionItemId).toBeNull()
  })

  // This test spawns a dedicated API server with SUBSCRIPTION_GUARD_ENABLED=false.
  // Skip in shared-server mode (parallel runs) — only run with RUN_GUARD_DISABLED_TEST=1.
  it.skipIf(process.env.RUN_GUARD_DISABLED_TEST !== '1')(
    'enforces subscription guard for usage summary and allows bypass when disabled', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `guard-owner-${uid}@example.com`,
      password: 'guard-owner-pass-12345',
      name: 'Guard Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Guard Team'
    })

    const periodStart = new Date(Date.now() - (1000 * 60 * 60 * 24)).toISOString()
    const periodEnd = new Date(Date.now() + (1000 * 60 * 60 * 24)).toISOString()

    const guardedResponse = await request<{ message: string }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'usage-summary-guard-enabled',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(guardedResponse.response.status).toBe(401)

    const previousGuardValue = process.env.SUBSCRIPTION_GUARD_ENABLED
    process.env.SUBSCRIPTION_GUARD_ENABLED = 'false'
    const guardDisabledContext = createDbAuthContext({
      apiCwd,
      host: '127.0.0.1',
      port: 4200 + Number.parseInt(process.env.WORKTREE_PORT_OFFSET ?? '0', 10),
      authSecret: integrationAuthSecret,
      corsOrigin: 'http://localhost:3000',
      sql: {
        schemaPrefix: 'api_guard_disabled'
      }
    })

    try {
      await guardDisabledContext.setup()
      await guardDisabledContext.reset()

      const guardDisabledFactoryContext = guardDisabledContext.apiFactoryContext
      const guardDisabledOwner = await createUser(guardDisabledFactoryContext, {
        email: `guard-disabled-owner-${uid}@example.com`,
        password: 'guard-disabled-owner-pass-12345',
        name: 'Guard Disabled Owner'
      })

      const guardDisabledOrganization = await createOrganization(guardDisabledFactoryContext, {
        token: guardDisabledOwner.token,
        name: 'Guard Disabled Team'
      })

      const unguardedResponseRaw = await fetch(
        `${guardDisabledContext.baseUrl}/v1/organizations/${guardDisabledOrganization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${guardDisabledOwner.token}`,
            ...guardDisabledContext.testContext.headersForCase(
              'usage-summary-guard-disabled',
              {
                'content-type': 'application/json'
              }
            )
          }
        }
      )

      const unguardedResponse = await unguardedResponseRaw.json() as { totalQuantity: number }

      expect(unguardedResponseRaw.status).toBe(200)
      expect(unguardedResponse.totalQuantity).toBe(0)
    } finally {
      await guardDisabledContext.teardown()
      if (previousGuardValue === undefined) {
        delete process.env.SUBSCRIPTION_GUARD_ENABLED
      } else {
        process.env.SUBSCRIPTION_GUARD_ENABLED = previousGuardValue
      }
    }
  })

  it('returns aggregated usage summaries for active subscriptions', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `usage-owner-${uid}@example.com`,
      password: 'usage-owner-pass-12345',
      name: 'Usage Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Usage Team'
    })

    const webhookPayload = {
      id: stripeId('evt_usage_sync_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_usage_sync_1'),
          customer: stripeId('cus_usage_sync_1'),
          status: 'active',
          metadata: {
            organizationId: organization.id
          },
          items: {
            data: []
          }
        }
      }
    }

    const webhook = await request<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'usage-webhook-active',
      {
        method: 'POST',
        headers: {
          'stripe-signature': 'integration-signature'
        },
        body: JSON.stringify(webhookPayload)
      }
    )

    expect(webhook.response.status).toBe(200)
    expect(webhook.body.processed).toBe(true)

    const inWindowRecordedAt = new Date(Date.now() - (1000 * 60 * 30))
    const outOfWindowRecordedAt = new Date(Date.now() - (1000 * 60 * 60 * 24 * 10))

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO usage_records (
            organization_id,
            category,
            quantity,
            unit_cost_decimillicents,
            total_cost_decimillicents,
            metadata,
            recorded_at
          )
          VALUES
            ($1, 'api_call', 10, 100000, 1000000, '{}'::jsonb, $2),
            ($1, 'api_call', 99, 100000, 9900000, '{}'::jsonb, $3)
        `,
        [organization.id, inWindowRecordedAt, outOfWindowRecordedAt]
      )
    })

    const periodStart = new Date(Date.now() - (1000 * 60 * 60 * 2)).toISOString()
    const periodEnd = new Date(Date.now() + (1000 * 60 * 60)).toISOString()

    const usageSummary = await request<{ totalQuantity: number; totalCostDecimillicents: number }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'usage-summary-aggregate',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(usageSummary.response.status).toBe(200)
    expect(usageSummary.body.totalQuantity).toBe(10)
    expect(usageSummary.body.totalCostDecimillicents).toBe(1_000_000)
  })

  it('processes invoice.payment_succeeded webhook and promotes subscription from past_due to active', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `invoice-success-owner-${uid}@example.com`,
      password: 'invoice-success-pass-12345',
      name: 'Invoice Success Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invoice Success Team'
    })

    const setupPayload = {
      id: stripeId('evt_invoice_setup_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_invoice_test_1'),
          customer: stripeId('cus_invoice_test_1'),
          status: 'past_due',
          start_date: Math.floor(Date.now() / 1000) - 100,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          metadata: { organizationId: organization.id },
          items: { data: [] }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'invoice-setup-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(setupPayload)
    })

    const settingsBefore = await request<{ subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-before-invoice-success',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settingsBefore.body.subscriptionStatus).toBe('past_due')

    const invoicePayload = {
      id: stripeId('evt_invoice_paid_1'),
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_paid_1',
          customer: stripeId('cus_invoice_test_1'),
          subscription: stripeId('sub_invoice_test_1'),
          metadata: { organizationId: organization.id }
        }
      }
    }

    const result = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'invoice-payment-succeeded',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(invoicePayload)
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.processed).toBe(true)

    const settingsAfter = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-invoice-success',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settingsAfter.body.isSubscribed).toBe(true)
    expect(settingsAfter.body.subscriptionStatus).toBe('active')
  })

  it('processes customer.subscription.deleted webhook and marks subscription as canceled', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `sub-deleted-owner-${uid}@example.com`,
      password: 'sub-deleted-pass-12345',
      name: 'Sub Deleted Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Sub Deleted Team'
    })

    const activatePayload = {
      id: stripeId('evt_activate_for_delete_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_to_delete_1'),
          customer: stripeId('cus_to_delete_1'),
          status: 'active',
          start_date: Math.floor(Date.now() / 1000) - 100,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          metadata: { organizationId: organization.id },
          items: { data: [] }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'activate-for-delete', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(activatePayload)
    })

    const deletePayload = {
      id: stripeId('evt_sub_deleted_1'),
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: stripeId('sub_to_delete_1'),
          customer: stripeId('cus_to_delete_1'),
          status: 'canceled',
          metadata: { organizationId: organization.id }
        }
      }
    }

    const result = await request<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'sub-deleted-webhook',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(deletePayload)
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.processed).toBe(true)

    const settingsAfter = await request<{
      isSubscribed: boolean
      subscriptionStatus: string
      stripeSubscriptionId: string | null
      stripeMeteredSubscriptionItemId: string | null
    }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-sub-deleted',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settingsAfter.body.isSubscribed).toBe(false)
    expect(settingsAfter.body.subscriptionStatus).toBe('canceled')
    expect(settingsAfter.body.stripeSubscriptionId).toBeNull()
    expect(settingsAfter.body.stripeMeteredSubscriptionItemId).toBeNull()
  })

  it('processes invoice.payment_failed webhook and marks subscription as past_due', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `payment-failed-owner-${uid}@example.com`,
      password: 'payment-failed-pass-12345',
      name: 'Payment Failed Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Payment Failed Team'
    })

    const activatePayload = {
      id: stripeId('evt_activate_for_fail_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_to_fail_1'),
          customer: stripeId('cus_to_fail_1'),
          status: 'active',
          start_date: Math.floor(Date.now() / 1000) - 100,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          metadata: { organizationId: organization.id },
          items: { data: [] }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'activate-for-fail', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(activatePayload)
    })

    const failPayload = {
      id: stripeId('evt_payment_failed_1'),
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_failed_1',
          customer: stripeId('cus_to_fail_1'),
          subscription: stripeId('sub_to_fail_1'),
          metadata: { organizationId: organization.id }
        }
      }
    }

    const result = await request<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'payment-failed-webhook',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(failPayload)
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.processed).toBe(true)

    const settingsAfter = await request<{ subscriptionStatus: string; isSubscribed: boolean }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-payment-failed',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settingsAfter.body.subscriptionStatus).toBe('past_due')
    expect(settingsAfter.body.isSubscribed).toBe(true)
  })

  it('invoice.payment_succeeded does not resurrect a canceled subscription', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `no-resurrect-owner-${uid}@example.com`,
      password: 'no-resurrect-pass-12345',
      name: 'No Resurrect Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'No Resurrect Team'
    })

    const cancelPayload = {
      id: stripeId('evt_cancel_for_no_resurrect'),
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: stripeId('sub_no_resurrect_1'),
          customer: stripeId('cus_no_resurrect_1'),
          status: 'canceled',
          metadata: { organizationId: organization.id }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'cancel-for-no-resurrect', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(cancelPayload)
    })

    const invoicePayload = {
      id: stripeId('evt_resurrect_attempt'),
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_resurrect_1',
          customer: stripeId('cus_no_resurrect_1'),
          subscription: stripeId('sub_no_resurrect_1'),
          metadata: { organizationId: organization.id }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'resurrect-attempt', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(invoicePayload)
    })

    const settings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-no-resurrect',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settings.body.isSubscribed).toBe(false)
    expect(settings.body.subscriptionStatus).toBe('canceled')
  })

  it('processes checkout.session.completed and persists stripe customer and subscription ids', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `checkout-complete-owner-${uid}@example.com`,
      password: 'checkout-complete-pass-12345',
      name: 'Checkout Complete Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Checkout Complete Team'
    })

    const settingsBefore = await request<{
      stripeCustomerId: string | null
      stripeSubscriptionId: string | null
      stripePaymentMethodId: string | null
    }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-before-checkout-complete',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settingsBefore.body.stripeCustomerId).toBeNull()
    expect(settingsBefore.body.stripeSubscriptionId).toBeNull()

    const checkoutPayload = {
      id: stripeId('evt_checkout_complete_1'),
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_checkout_1',
          customer: stripeId('cus_checkout_1'),
          subscription: stripeId('sub_checkout_1'),
          payment_method: stripeId('pm_checkout_1'),
          metadata: { organizationId: organization.id }
        }
      }
    }

    const result = await request<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'checkout-session-completed',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(checkoutPayload)
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.processed).toBe(true)

    const settingsAfter = await request<{
      stripeCustomerId: string | null
      stripeSubscriptionId: string | null
      stripePaymentMethodId: string | null
    }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-checkout-complete',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settingsAfter.body.stripeCustomerId).toBe(stripeId('cus_checkout_1'))
    expect(settingsAfter.body.stripeSubscriptionId).toBe(stripeId('sub_checkout_1'))
    expect(settingsAfter.body.stripePaymentMethodId).toBe(stripeId('pm_checkout_1'))
  })

  it('processes customer.subscription.created and initializes subscription state', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `sub-created-owner-${uid}@example.com`,
      password: 'sub-created-pass-12345',
      name: 'Sub Created Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Sub Created Team'
    })

    const createdPayload = {
      id: stripeId('evt_sub_created_1'),
      type: 'customer.subscription.created',
      data: {
        object: {
          id: stripeId('sub_created_1'),
          customer: stripeId('cus_created_1'),
          status: 'trialing',
          start_date: Math.floor(Date.now() / 1000) - 60,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 14,
          metadata: { organizationId: organization.id },
          items: {
            data: [
              { id: stripeId('si_created_metered_1'), price: { recurring: { usage_type: 'metered' } } }
            ]
          }
        }
      }
    }

    const result = await request<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'subscription-created-webhook',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(createdPayload)
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.processed).toBe(true)

    const settingsAfter = await request<{
      isSubscribed: boolean
      subscriptionStatus: string
      stripeSubscriptionId: string | null
      stripeMeteredSubscriptionItemId: string | null
    }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-sub-created',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settingsAfter.body.isSubscribed).toBe(true)
    expect(settingsAfter.body.subscriptionStatus).toBe('trialing')
    expect(settingsAfter.body.stripeSubscriptionId).toBe(stripeId('sub_created_1'))
    expect(settingsAfter.body.stripeMeteredSubscriptionItemId).toBeNull()
  })

  it('invoice.payment_failed does not resurrect a canceled subscription', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `no-resurrect-fail-owner-${uid}@example.com`,
      password: 'no-resurrect-fail-pass-12345',
      name: 'No Resurrect Fail Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'No Resurrect Fail Team'
    })

    const cancelPayload = {
      id: stripeId('evt_cancel_for_fail_no_resurrect'),
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: stripeId('sub_fail_no_resurrect_1'),
          customer: stripeId('cus_fail_no_resurrect_1'),
          status: 'canceled',
          metadata: { organizationId: organization.id }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'cancel-for-fail-no-resurrect', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(cancelPayload)
    })

    const failPayload = {
      id: stripeId('evt_fail_no_resurrect'),
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_fail_no_resurrect_1',
          customer: stripeId('cus_fail_no_resurrect_1'),
          subscription: stripeId('sub_fail_no_resurrect_1'),
          metadata: { organizationId: organization.id }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'fail-no-resurrect-attempt', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(failPayload)
    })

    const settings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-fail-no-resurrect',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settings.body.isSubscribed).toBe(false)
    expect(settings.body.subscriptionStatus).toBe('canceled')
  })

  it('processes webhook events without a resolvable organizationId gracefully', async () => {
    const orphanPayload = {
      id: stripeId('evt_orphan_webhook_1'),
      type: 'customer.updated',
      data: {
        object: {
          id: stripeId('cus_orphan_unknown_1'),
          metadata: {}
        }
      }
    }

    const result = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'orphan-webhook-no-org',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(orphanPayload)
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.processed).toBe(true)
    expect(result.body.idempotent).toBe(false)
  })

  it('transitions subscription from trialing to active via customer.subscription.updated', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `trial-to-active-owner-${uid}@example.com`,
      password: 'trial-to-active-pass-12345',
      name: 'Trial To Active Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Trial To Active Team'
    })

    const trialPayload = {
      id: stripeId('evt_trial_start_1'),
      type: 'customer.subscription.created',
      data: {
        object: {
          id: stripeId('sub_trial_to_active_1'),
          customer: stripeId('cus_trial_to_active_1'),
          status: 'trialing',
          start_date: Math.floor(Date.now() / 1000) - 86_400 * 14,
          current_period_end: Math.floor(Date.now() / 1000),
          metadata: { organizationId: organization.id },
          items: { data: [] }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'trial-start', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(trialPayload)
    })

    const trialSettings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-trial-start',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(trialSettings.body.isSubscribed).toBe(true)
    expect(trialSettings.body.subscriptionStatus).toBe('trialing')

    const activatePayload = {
      id: stripeId('evt_trial_to_active_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_trial_to_active_1'),
          customer: stripeId('cus_trial_to_active_1'),
          status: 'active',
          start_date: Math.floor(Date.now() / 1000) - 86_400 * 14,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 30,
          metadata: { organizationId: organization.id },
          items: { data: [] }
        }
      }
    }

    const result = await request<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'trial-to-active-transition',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(activatePayload)
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.processed).toBe(true)

    const activeSettings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-trial-to-active',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(activeSettings.body.isSubscribed).toBe(true)
    expect(activeSettings.body.subscriptionStatus).toBe('active')
  })

  it('transitions past_due subscription to canceled via customer.subscription.deleted', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `pastdue-to-cancel-owner-${uid}@example.com`,
      password: 'pastdue-to-cancel-pass-12345',
      name: 'PastDue To Cancel Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'PastDue To Cancel Team'
    })

    // Step 1: Activate subscription
    const activatePayload = {
      id: stripeId('evt_activate_pastdue_cancel_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_pastdue_cancel_1'),
          customer: stripeId('cus_pastdue_cancel_1'),
          status: 'active',
          start_date: Math.floor(Date.now() / 1000) - 100,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          metadata: { organizationId: organization.id },
          items: { data: [] }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'activate-for-pastdue-cancel', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(activatePayload)
    })

    // Step 2: Payment fails -> past_due
    const failPayload = {
      id: stripeId('evt_fail_pastdue_cancel_1'),
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_fail_pastdue_cancel_1',
          customer: stripeId('cus_pastdue_cancel_1'),
          subscription: stripeId('sub_pastdue_cancel_1'),
          metadata: { organizationId: organization.id }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'fail-for-pastdue-cancel', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(failPayload)
    })

    const pastDueSettings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-verify-pastdue-before-cancel',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(pastDueSettings.body.isSubscribed).toBe(true)
    expect(pastDueSettings.body.subscriptionStatus).toBe('past_due')

    // Step 3: Stripe cancels after retry exhaustion -> canceled
    const deletePayload = {
      id: stripeId('evt_delete_pastdue_cancel_1'),
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: stripeId('sub_pastdue_cancel_1'),
          customer: stripeId('cus_pastdue_cancel_1'),
          status: 'canceled',
          metadata: { organizationId: organization.id }
        }
      }
    }

    const deleteResult = await request<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'delete-pastdue-cancel',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(deletePayload)
      }
    )

    expect(deleteResult.response.status).toBe(200)
    expect(deleteResult.body.processed).toBe(true)

    const canceledSettings = await request<{
      isSubscribed: boolean
      subscriptionStatus: string
      stripeSubscriptionId: string | null
      stripeMeteredSubscriptionItemId: string | null
    }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-pastdue-cancel',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(canceledSettings.body.isSubscribed).toBe(false)
    expect(canceledSettings.body.subscriptionStatus).toBe('canceled')
    expect(canceledSettings.body.stripeSubscriptionId).toBeNull()
    expect(canceledSettings.body.stripeMeteredSubscriptionItemId).toBeNull()
  })

  it('recovers from payment failure: active -> past_due -> active via payment_succeeded', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `recovery-flow-owner-${uid}@example.com`,
      password: 'recovery-flow-pass-12345',
      name: 'Recovery Flow Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Recovery Flow Team'
    })

    // Step 1: Activate subscription
    const activatePayload = {
      id: stripeId('evt_activate_recovery_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_recovery_1'),
          customer: stripeId('cus_recovery_1'),
          status: 'active',
          start_date: Math.floor(Date.now() / 1000) - 100,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          metadata: { organizationId: organization.id },
          items: { data: [] }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'activate-for-recovery', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(activatePayload)
    })

    const activeSettings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-verify-active-recovery',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(activeSettings.body.isSubscribed).toBe(true)
    expect(activeSettings.body.subscriptionStatus).toBe('active')

    // Step 2: Payment fails -> past_due (subscription still accessible)
    const failPayload = {
      id: stripeId('evt_fail_recovery_1'),
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_fail_recovery_1',
          customer: stripeId('cus_recovery_1'),
          subscription: stripeId('sub_recovery_1'),
          metadata: { organizationId: organization.id }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'fail-for-recovery', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(failPayload)
    })

    const pastDueSettings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-verify-pastdue-recovery',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(pastDueSettings.body.isSubscribed).toBe(true)
    expect(pastDueSettings.body.subscriptionStatus).toBe('past_due')

    // Step 3: Payment succeeds (retry or card update) -> active
    const successPayload = {
      id: stripeId('evt_success_recovery_1'),
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_success_recovery_1',
          customer: stripeId('cus_recovery_1'),
          subscription: stripeId('sub_recovery_1'),
          metadata: { organizationId: organization.id }
        }
      }
    }

    const successResult = await request<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'success-for-recovery',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(successPayload)
      }
    )

    expect(successResult.response.status).toBe(200)
    expect(successResult.body.processed).toBe(true)

    const recoveredSettings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-recovery',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(recoveredSettings.body.isSubscribed).toBe(true)
    expect(recoveredSettings.body.subscriptionStatus).toBe('active')
  })

  it('past_due subscription still allows usage summary access', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `pastdue-access-owner-${uid}@example.com`,
      password: 'pastdue-access-pass-12345',
      name: 'PastDue Access Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'PastDue Access Team'
    })

    // Activate with past_due status via subscription.updated
    const pastDuePayload = {
      id: stripeId('evt_pastdue_access_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_pastdue_access_1'),
          customer: stripeId('cus_pastdue_access_1'),
          status: 'past_due',
          start_date: Math.floor(Date.now() / 1000) - 100,
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          metadata: { organizationId: organization.id },
          items: { data: [] }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'setup-pastdue-access', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(pastDuePayload)
    })

    const settings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-verify-pastdue-access',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(settings.body.isSubscribed).toBe(true)
    expect(settings.body.subscriptionStatus).toBe('past_due')

    // Usage summary should be accessible (past_due is treated as active)
    const periodStart = new Date(Date.now() - (1000 * 60 * 60 * 24)).toISOString()
    const periodEnd = new Date(Date.now() + (1000 * 60 * 60 * 24)).toISOString()

    const usageSummary = await request<{ totalQuantity: number }>(
      `/v1/organizations/${organization.id}/usage?category=api_call&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
      'usage-summary-pastdue-access',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(usageSummary.response.status).toBe(200)
    expect(usageSummary.body.totalQuantity).toBe(0)
  })

  it('invoice.payment_failed does not change an unpaid subscription to past_due', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `unpaid-guard-owner-${uid}@example.com`,
      password: 'unpaid-guard-pass-12345',
      name: 'Unpaid Guard Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Unpaid Guard Team'
    })

    // Set subscription to unpaid via subscription.updated
    const unpaidPayload = {
      id: stripeId('evt_set_unpaid_guard_1'),
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: stripeId('sub_unpaid_guard_1'),
          customer: stripeId('cus_unpaid_guard_1'),
          status: 'unpaid',
          start_date: Math.floor(Date.now() / 1000) - 86_400 * 30,
          current_period_end: Math.floor(Date.now() / 1000) - 86_400,
          metadata: { organizationId: organization.id },
          items: { data: [] }
        }
      }
    }

    await request('/v1/webhooks/stripe', 'set-unpaid-guard', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(unpaidPayload)
    })

    const unpaidSettings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-verify-unpaid-guard',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(unpaidSettings.body.isSubscribed).toBe(false)
    expect(unpaidSettings.body.subscriptionStatus).toBe('unpaid')

    // invoice.payment_failed should NOT change unpaid -> past_due
    const failPayload = {
      id: stripeId('evt_fail_unpaid_guard_1'),
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_fail_unpaid_guard_1',
          customer: stripeId('cus_unpaid_guard_1'),
          subscription: stripeId('sub_unpaid_guard_1'),
          metadata: { organizationId: organization.id }
        }
      }
    }

    const failResult = await request<{ processed: boolean }>(
      '/v1/webhooks/stripe',
      'fail-unpaid-guard',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(failPayload)
      }
    )

    expect(failResult.response.status).toBe(200)
    expect(failResult.body.processed).toBe(true)

    // Status must remain unpaid, not resurrected to past_due
    const afterSettings = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${organization.id}/billing`,
      'billing-after-unpaid-guard',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(afterSettings.body.isSubscribed).toBe(false)
    expect(afterSettings.body.subscriptionStatus).toBe('unpaid')
  })

  // Note: the sequential "duplicate webhook delivery only grants credits
  // once" test that used to live here is strictly dominated by
  // billing-webhook-concurrency.e2e which fires 10 parallel deliveries
  // and proves the same exactly-once invariant under a harder race.
  // Removed to avoid duplicate coverage.

  it('[INV-BILLING-009] charge.dispute.created freezes credit balance and emits billing.dispute_created', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `dispute-created-owner-${uid}@example.com`,
      password: 'dispute-created-pass-12345',
      name: 'Dispute Created Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Dispute Created Team'
    })

    // Link org to the Stripe customer we'll reference in the dispute event.
    const disputeCustomer = `cus_dispute_created_${uid}`
    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        'UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2',
        [disputeCustomer, organization.id]
      )
    })

    const eventId = `evt_dispute_created_${uid}`
    const disputePayload = {
      id: eventId,
      type: 'charge.dispute.created',
      data: {
        object: {
          id: `dp_created_${uid}`,
          customer: disputeCustomer,
          amount: 2500, // cents → 250_000_000 decimillicents
          metadata: { organizationId: organization.id }
        }
      }
    }

    const result = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'dispute-created-webhook',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify(disputePayload)
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body.processed).toBe(true)
    expect(result.body.idempotent).toBe(false)

    await factoryContext.testContext.withSchemaClient(async (client) => {
      const events = await client.query<{
        event_type: string
        aggregate_id: string
        payload: {
          organizationId: string
          stripeEventId: string
          chargeAmountDecimillicents: number
        }
      }>(
        `SELECT event_type, aggregate_id, payload FROM domain_events
         WHERE event_type = 'billing.dispute_created' AND aggregate_id = $1`,
        [organization.id]
      )
      expect(events.rows).toHaveLength(1)
      const row = events.rows[0]
      expect(row?.payload.organizationId).toBe(organization.id)
      expect(row?.payload.stripeEventId).toBe(eventId)
      expect(row?.payload.chargeAmountDecimillicents).toBe(250_000_000)

      const ledgerRows = await client.query<{
        amount_decimillicents: string
        entry_type: string
        metadata: { disputeHold?: boolean }
      }>(
        'SELECT amount_decimillicents, entry_type, metadata FROM credit_ledger WHERE stripe_event_id = $1',
        [eventId]
      )
      expect(ledgerRows.rows).toHaveLength(1)
      expect(ledgerRows.rows[0]?.entry_type).toBe('adjustment')
      expect(Number(ledgerRows.rows[0]?.amount_decimillicents)).toBe(0)
      expect(ledgerRows.rows[0]?.metadata.disputeHold).toBe(true)
    })
  })

  // NOTE: `charge.dispute.closed` lost/won/warning_closed/missing/unknown/
  // idempotency coverage lives in `billing-dispute-outcomes.e2e.integration.test.ts`.
  // The old test here only exercised the `lost` branch and was fully
  // subsumed by the specialized suite.
})
