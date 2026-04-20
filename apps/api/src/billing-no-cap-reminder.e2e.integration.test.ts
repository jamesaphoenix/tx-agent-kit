import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_no_cap_reminder'
})

const seedOwnerOrg = async (suffix: string): Promise<{ orgId: string; token: string }> => {
  const ctx = getFactoryContext()
  const owner = await createUser(ctx, {
    email: `no-cap-reminder-${suffix}-${uid}@example.com`,
    password: 'no-cap-reminder-pass-12345',
    name: `No Cap Reminder ${suffix} Owner`
  })
  const org = await createOrganization(ctx, {
    token: owner.token,
    name: `No Cap Reminder ${suffix} Org`
  })
  return { orgId: org.id, token: owner.token }
}

describe('billing no-cap reminder preference', () => {
  it('defaults to not dismissed and persists dismissal for the current user and org', async () => {
    const { orgId, token } = await seedOwnerOrg('persist')

    const initial = await request<{ dismissed: boolean }>(
      `/v1/billing/${orgId}/no-cap-reminder`,
      'no-cap-reminder-get-initial',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` }
      }
    )

    expect(initial.response.status).toBe(200)
    expect(initial.body.dismissed).toBe(false)

    const dismissed = await request<{ dismissed: boolean }>(
      `/v1/billing/${orgId}/no-cap-reminder/dismiss`,
      'no-cap-reminder-dismiss',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` }
      }
    )

    expect(dismissed.response.status).toBe(200)
    expect(dismissed.body.dismissed).toBe(true)

    const afterDismiss = await request<{ dismissed: boolean }>(
      `/v1/billing/${orgId}/no-cap-reminder`,
      'no-cap-reminder-get-after-dismiss',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` }
      }
    )

    expect(afterDismiss.response.status).toBe(200)
    expect(afterDismiss.body.dismissed).toBe(true)
  })

  it('scopes dismissal to the current user and organization', async () => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `no-cap-reminder-scope-owner-${uid}@example.com`,
      password: 'no-cap-reminder-scope-pass-12345',
      name: 'No Cap Reminder Scope Owner'
    })
    const teammate = await createUser(factoryContext, {
      email: `no-cap-reminder-scope-teammate-${uid}@example.com`,
      password: 'no-cap-reminder-scope-pass-12345',
      name: 'No Cap Reminder Scope Teammate'
    })
    const orgA = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'No Cap Reminder Scope Org A'
    })
    const orgB = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'No Cap Reminder Scope Org B'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO org_members (organization_id, user_id, role)
          VALUES ($1, $2, 'admin')
          ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
        `,
        [orgA.id, teammate.user.id]
      )
    })

    const dismissed = await request<{ dismissed: boolean }>(
      `/v1/billing/${orgA.id}/no-cap-reminder/dismiss`,
      'no-cap-reminder-dismiss-scope-owner-org-a',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}` }
      }
    )

    expect(dismissed.response.status).toBe(200)
    expect(dismissed.body.dismissed).toBe(true)

    const sameUserDifferentOrg = await request<{ dismissed: boolean }>(
      `/v1/billing/${orgB.id}/no-cap-reminder`,
      'no-cap-reminder-get-scope-owner-org-b',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${owner.token}` }
      }
    )

    expect(sameUserDifferentOrg.response.status).toBe(200)
    expect(sameUserDifferentOrg.body.dismissed).toBe(false)

    const differentUserSameOrg = await request<{ dismissed: boolean }>(
      `/v1/billing/${orgA.id}/no-cap-reminder`,
      'no-cap-reminder-get-scope-teammate-org-a',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${teammate.token}` }
      }
    )

    expect(differentUserSameOrg.response.status).toBe(200)
    expect(differentUserSameOrg.body.dismissed).toBe(false)
  })
})
