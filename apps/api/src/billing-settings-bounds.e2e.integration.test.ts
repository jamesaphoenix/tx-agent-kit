import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Bounds tests for `PATCH /v1/billing/:orgId` (updateBillingSettings).
 *
 * The auto-recharge threshold/amount fields accept any JSON number. Before
 * the schema hardening:
 *
 *   - A negative threshold → every debit appears to be below it → auto-
 *     recharge fires on every credit-consuming operation.
 *   - A fractional amount → Stripe receives a float → weird rounding,
 *     bigint ledger math silently corrupted.
 *   - An astronomically large amount → Stripe rejects the charge, the
 *     attempt moves to permanent_failed, the user is stuck.
 *
 * Now the schema pins both fields to integer + [1 cent, $500] (the same
 * rails as one-time top-ups) and the threshold to integer >= 0.
 *
 * @spec billing-and-pricing-design §"Auto-recharge"
 */

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_settings_bounds'
})

const seedOwnerOrg = async (suffix: string): Promise<{ orgId: string; token: string }> => {
  const ctx = getFactoryContext()
  const owner = await createUser(ctx, {
    email: `settings-bounds-${suffix}-${uid}@example.com`,
    password: 'settings-bounds-pass-12345',
    name: `Settings Bounds ${suffix} Owner`
  })
  const org = await createOrganization(ctx, {
    token: owner.token,
    name: `Settings Bounds ${suffix} Org`
  })
  return { orgId: org.id, token: owner.token }
}

const patch = async (
  orgId: string,
  token: string,
  body: Record<string, unknown>,
  label: string
) =>
  request<{ message?: string }>(
    `/v1/organizations/${orgId}/billing`,
    label,
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    }
  )

describe('PATCH /v1/organizations/:orgId/billing auto-recharge bounds', () => {
  // @spec billing-and-pricing-design §"Auto-recharge"
  it('rejects a negative autoRechargeThresholdDecimillicents with 4xx', async () => {
    const { orgId, token } = await seedOwnerOrg('neg-threshold')
    const res = await patch(orgId, token, {
      autoRechargeEnabled: true,
      autoRechargeThresholdDecimillicents: -1,
      autoRechargeAmountDecimillicents: 500_000
    }, 'neg-threshold')
    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)
  })

  // @spec billing-and-pricing-design §"Auto-recharge"
  it('rejects a fractional autoRechargeAmountDecimillicents with 4xx', async () => {
    const { orgId, token } = await seedOwnerOrg('frac-amount')
    const res = await patch(orgId, token, {
      autoRechargeEnabled: true,
      autoRechargeThresholdDecimillicents: 1_000_000,
      autoRechargeAmountDecimillicents: 500_000.5
    }, 'frac-amount')
    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)
  })

  // @spec billing-and-pricing-design §"Auto-recharge"
  it('rejects an autoRechargeAmountDecimillicents below the 1-cent floor', async () => {
    const { orgId, token } = await seedOwnerOrg('under-amount')
    const res = await patch(orgId, token, {
      autoRechargeEnabled: true,
      autoRechargeThresholdDecimillicents: 1_000_000,
      autoRechargeAmountDecimillicents: 99_999 // < 1 cent
    }, 'under-amount')
    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)
  })

  // @spec billing-and-pricing-design §"Auto-recharge"
  it('rejects an autoRechargeAmountDecimillicents above the $500 cap', async () => {
    const { orgId, token } = await seedOwnerOrg('over-amount')
    const res = await patch(orgId, token, {
      autoRechargeEnabled: true,
      autoRechargeThresholdDecimillicents: 1_000_000,
      autoRechargeAmountDecimillicents: 5_000_000_001 // > $500
    }, 'over-amount')
    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)
  })

  it('rejects an unsafe integer usageCapDecimillicents before it can reach bigint-backed billing state', async () => {
    const { orgId, token } = await seedOwnerOrg('unsafe-usage-cap')
    const res = await patch(orgId, token, {
      usageCapDecimillicents: Number.MAX_SAFE_INTEGER + 1
    }, 'unsafe-usage-cap')
    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)
  })

  // @spec billing-and-pricing-design §"Auto-recharge"
  // The schema floor is 1 decimillicent, NOT 0 — a zero threshold
  // would silently disable auto-recharge forever because the ledger
  // only emits `billing.credits_low_balance` when threshold > 0.
  it('rejects autoRechargeThresholdDecimillicents = 0 (silent-kill trap)', async () => {
    const { orgId, token } = await seedOwnerOrg('zero-threshold')
    const res = await patch(orgId, token, {
      autoRechargeEnabled: true,
      autoRechargeThresholdDecimillicents: 0,
      autoRechargeAmountDecimillicents: 10_000_000
    }, 'zero-threshold')
    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)
  })

  // @spec billing-and-pricing-design §"Auto-recharge"
  it('accepts a valid autoRecharge config at the real boundary (threshold=1, amount=$1)', async () => {
    const { orgId, token } = await seedOwnerOrg('valid-boundary')
    const res = await patch(orgId, token, {
      autoRechargeEnabled: true,
      autoRechargeThresholdDecimillicents: 1,
      autoRechargeAmountDecimillicents: 10_000_000 // $1
    }, 'valid-boundary')
    expect(res.response.status).toBe(200)
  })

  // @spec billing-and-pricing-design §"Auto-recharge"
  // Enabling auto-recharge without a threshold + amount configured
  // would leave the worker silently no-op'ing on every low-balance
  // signal — the user thinks the feature works, burns their credit,
  // then gets suspended. Require both fields on enable.
  it('rejects autoRechargeEnabled=true when no amount has ever been configured', async () => {
    const { orgId, token } = await seedOwnerOrg('enable-no-amount')
    const res = await patch(orgId, token, {
      autoRechargeEnabled: true
    }, 'enable-no-amount')
    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)
  })

  it('rejects enabling auto-recharge while clearing the amount in the same patch', async () => {
    const { orgId, token } = await seedOwnerOrg('enable-clear-amount')

    // First, seed a valid config so the row has non-null values.
    const seed = await patch(orgId, token, {
      autoRechargeEnabled: false,
      autoRechargeThresholdDecimillicents: 1_000_000,
      autoRechargeAmountDecimillicents: 10_000_000
    }, 'enable-clear-amount-seed')
    expect(seed.response.status).toBe(200)

    // Now try to enable while nulling out the amount — broken state.
    const res = await patch(orgId, token, {
      autoRechargeEnabled: true,
      autoRechargeAmountDecimillicents: null
    }, 'enable-clear-amount')
    expect(res.response.status).toBeGreaterThanOrEqual(400)
    expect(res.response.status).toBeLessThan(500)
  })

  it('rejects clearing amount or threshold while auto-recharge is already enabled', async () => {
    const { orgId, token } = await seedOwnerOrg('clear-enabled')

    const seed = await patch(orgId, token, {
      autoRechargeEnabled: true,
      autoRechargeThresholdDecimillicents: 1_000_000,
      autoRechargeAmountDecimillicents: 10_000_000
    }, 'clear-enabled-seed')
    expect(seed.response.status).toBe(200)

    const clearAmount = await patch(orgId, token, {
      autoRechargeAmountDecimillicents: null
    }, 'clear-enabled-amount')
    expect(clearAmount.response.status).toBeGreaterThanOrEqual(400)
    expect(clearAmount.response.status).toBeLessThan(500)

    const clearThreshold = await patch(orgId, token, {
      autoRechargeThresholdDecimillicents: null
    }, 'clear-enabled-threshold')
    expect(clearThreshold.response.status).toBeGreaterThanOrEqual(400)
    expect(clearThreshold.response.status).toBeLessThan(500)
  })

  it('allows re-enabling auto-recharge when the row already has threshold + amount', async () => {
    const { orgId, token } = await seedOwnerOrg('reenable')

    const seed = await patch(orgId, token, {
      autoRechargeEnabled: false,
      autoRechargeThresholdDecimillicents: 1_000_000,
      autoRechargeAmountDecimillicents: 10_000_000
    }, 'reenable-seed')
    expect(seed.response.status).toBe(200)

    // Re-enable without re-sending the amount/threshold.
    const res = await patch(orgId, token, {
      autoRechargeEnabled: true
    }, 'reenable')
    expect(res.response.status).toBe(200)
  })
})
