import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_local_dev_complete'
})

const seedOwnerOrg = async (
  suffix: string
): Promise<{ orgId: string; token: string }> => {
  const ctx = getFactoryContext()
  const owner = await createUser(ctx, {
    email: `billing-local-dev-${suffix}-${uid}@example.com`,
    password: 'billing-local-dev-pass-12345',
    name: `Billing Local Dev ${suffix} Owner`
  })
  const org = await createOrganization(ctx, {
    token: owner.token,
    name: `Billing Local Dev ${suffix} Org`
  })
  return { orgId: org.id, token: owner.token }
}

describe('POST /v1/billing/:orgId/dev/complete-local', () => {
  it('activates local billing idempotently and grants the one-time welcome credit once [INV-REQ-BILLING-AND-PRICING-007]', async () => {
    const { orgId, token } = await seedOwnerOrg('first')

    const firstActivation = await request<{
      isSubscribed: boolean
      subscriptionStatus: string
      subscriptionPlan: string | null
      stripeCustomerId: string | null
      stripeSubscriptionId: string | null
      stripePaymentMethodId: string | null
      creditsBalanceDecimillicents: number
      subscriptionCurrentPeriodEnd: string | null
    }>(
      `/v1/billing/${orgId}/dev/complete-local`,
      'billing-local-dev-first',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          subscriptionPlan: 'pro'
        })
      }
    )

    expect(firstActivation.response.status).toBe(200)
    expect(firstActivation.body.isSubscribed).toBe(true)
    expect(firstActivation.body.subscriptionStatus).toBe('active')
    expect(firstActivation.body.subscriptionPlan).toBe('pro')
    expect(firstActivation.body.stripeCustomerId).toMatch(/^cus_/)
    expect(firstActivation.body.stripeSubscriptionId).toMatch(/^sub_/)
    expect(firstActivation.body.stripePaymentMethodId).toMatch(/^pm_/)
    expect(firstActivation.body.creditsBalanceDecimillicents).toBe(200_000_000)
    expect(firstActivation.body.subscriptionCurrentPeriodEnd).not.toBeNull()

    const secondActivation = await request<{
      isSubscribed: boolean
      subscriptionStatus: string
      subscriptionPlan: string | null
      creditsBalanceDecimillicents: number
    }>(
      `/v1/billing/${orgId}/dev/complete-local`,
      'billing-local-dev-second',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          subscriptionPlan: 'agency'
        })
      }
    )

    expect(secondActivation.response.status).toBe(200)
    expect(secondActivation.body.isSubscribed).toBe(true)
    expect(secondActivation.body.subscriptionStatus).toBe('active')
    expect(secondActivation.body.subscriptionPlan).toBe('agency')
    expect(secondActivation.body.creditsBalanceDecimillicents).toBe(200_000_000)
  })
})
