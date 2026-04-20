import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Per-org rate limit on the three Stripe session-creation endpoints:
 *   - POST /v1/billing/checkout
 *   - POST /v1/billing/portal
 *   - POST /v1/billing/:orgId/top-up
 *
 * Each call costs money (Stripe API call) and without a limit a
 * logged-in attacker could spam them. The limit is 10 requests per
 * 60 seconds per (path, organizationId). Hitting the ceiling
 * returns 429; different orgs share no budget.
 *
 * The limiter lives in-process — this test runs against a single
 * shared API server and resets the in-memory buckets between
 * specs by using unique orgs per test.
 */

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_rate_limit'
})

const LIMIT = 10

let counter = 0
const nextSuffix = (): string => {
  counter += 1
  return `${counter}-${uid}`
}

beforeEach(() => {
  // Each test creates its own org so the per-(path, org) bucket
  // is always fresh. No global reset needed.
})

const seedOwnerOrg = async (
  suffix: string
): Promise<{ orgId: string; token: string }> => {
  const ctx = getFactoryContext()
  const owner = await createUser(ctx, {
    email: `rate-limit-${suffix}@example.com`,
    password: 'rate-limit-pass-12345',
    name: `Rate Limit ${suffix} Owner`
  })
  const org = await createOrganization(ctx, {
    token: owner.token,
    name: `Rate Limit ${suffix} Org`
  })
  return { orgId: org.id, token: owner.token }
}

describe('billing session rate limiting', () => {
  it('blocks the 11th createTopUpSession call in the same window', async () => {
    const suffix = nextSuffix()
    const { orgId, token } = await seedOwnerOrg(suffix)

    const fire = async (label: string) =>
      request<{ url?: string; message?: string }>(
        `/v1/billing/${orgId}/top-up`,
        label,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({
            amountDecimillicents: 10_000_000, // $1
            successUrl: 'https://example.com/s',
            cancelUrl: 'https://example.com/c'
          })
        }
      )

    // First LIMIT calls should succeed.
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await fire(`topup-${suffix}-${i}`)
      expect(res.response.status).toBe(200)
    }

    // LIMIT + 1 should be rate-limited.
    const blocked = await fire(`topup-${suffix}-blocked`)
    expect(blocked.response.status).toBe(429)
  })

  it('blocks createCheckoutSession independently of createPortalSession', async () => {
    const suffix = nextSuffix()
    const { orgId, token } = await seedOwnerOrg(suffix)

    const fireCheckout = async (label: string) =>
      request<{ url?: string; message?: string }>(
        '/v1/billing/checkout',
        label,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({
            organizationId: orgId,
            subscriptionPlan: 'pro',
            successUrl: 'https://example.com/s',
            cancelUrl: 'https://example.com/c'
          })
        }
      )

    const firePortal = async (label: string) =>
      request<{ url?: string; message?: string }>(
        '/v1/billing/portal',
        label,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({
            organizationId: orgId,
            returnUrl: 'https://example.com/r'
          })
        }
      )

    for (let i = 0; i < LIMIT; i += 1) {
      const res = await fireCheckout(`checkout-${suffix}-${i}`)
      expect(res.response.status).toBe(200)
    }
    const blockedCheckout = await fireCheckout(`checkout-${suffix}-blocked`)
    expect(blockedCheckout.response.status).toBe(429)

    // Portal endpoint should still be unblocked — bucket is per-path.
    const portal = await firePortal(`portal-${suffix}-first`)
    expect(portal.response.status).toBe(200)
  })

  it('different orgs do not share a budget', async () => {
    const suffixA = nextSuffix()
    const suffixB = nextSuffix()
    const a = await seedOwnerOrg(suffixA)
    const b = await seedOwnerOrg(suffixB)

    const fireFor = async (
      orgId: string,
      token: string,
      label: string
    ) =>
      request<{ url?: string; message?: string }>(
        `/v1/billing/${orgId}/top-up`,
        label,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({
            amountDecimillicents: 10_000_000,
            successUrl: 'https://example.com/s',
            cancelUrl: 'https://example.com/c'
          })
        }
      )

    // Exhaust org A.
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await fireFor(a.orgId, a.token, `a-${suffixA}-${i}`)
      expect(res.response.status).toBe(200)
    }
    const blockedA = await fireFor(a.orgId, a.token, `a-${suffixA}-blocked`)
    expect(blockedA.response.status).toBe(429)

    // Org B should still be completely unblocked.
    const resB = await fireFor(b.orgId, b.token, `b-${suffixB}-first`)
    expect(resB.response.status).toBe(200)
  })
})
