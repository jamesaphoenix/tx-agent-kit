import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_settings_usage_cap'
})

const seedOwnerOrg = async (suffix: string): Promise<{ orgId: string; token: string }> => {
  const ctx = getFactoryContext()
  const owner = await createUser(ctx, {
    email: `settings-usage-cap-${suffix}-${uid}@example.com`,
    password: 'settings-usage-cap-pass-12345',
    name: `Usage Cap ${suffix} Owner`
  })
  const org = await createOrganization(ctx, {
    token: owner.token,
    name: `Usage Cap ${suffix} Org`
  })
  return { orgId: org.id, token: owner.token }
}

const patch = async (
  orgId: string,
  token: string,
  body: Record<string, unknown>,
  label: string
) =>
  request<{
    usageCapDecimillicents?: number | null
  }>(
    `/v1/organizations/${orgId}/billing`,
    label,
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    }
  )

describe('PATCH /v1/organizations/:orgId/billing usage-cap persistence', () => {
  it('persists usageCapDecimillicents when set through billing settings', async () => {
    const { orgId, token } = await seedOwnerOrg('set')

    const res = await patch(orgId, token, {
      usageCapDecimillicents: 250_000_000
    }, 'usage-cap-set')

    expect(res.response.status).toBe(200)
    expect(res.body.usageCapDecimillicents).toBe(250_000_000)
  })

  it('clears usageCapDecimillicents when explicitly set to null', async () => {
    const { orgId, token } = await seedOwnerOrg('clear')

    const seed = await patch(orgId, token, {
      usageCapDecimillicents: 100_000_000
    }, 'usage-cap-clear-seed')
    expect(seed.response.status).toBe(200)
    expect(seed.body.usageCapDecimillicents).toBe(100_000_000)

    const cleared = await patch(orgId, token, {
      usageCapDecimillicents: null
    }, 'usage-cap-clear')

    expect(cleared.response.status).toBe(200)
    expect(cleared.body.usageCapDecimillicents).toBeNull()
  })
})
