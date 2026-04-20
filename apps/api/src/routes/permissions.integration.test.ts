import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import {
  createTestFixture
} from './test-helpers.js'

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'api_perms'
})

describe('permissions integration', () => {
  it('returns role-based permission maps and resolves permissions on auth/me', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      name: 'Permissions Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Permissions Team'
    })

    const mapResponse = await request<Record<string, string[]>>(
      '/v1/permissions',
      'permissions-map',
      {
        method: 'GET'
      }
    )

    expect(mapResponse.response.status).toBe(200)
    expect(mapResponse.body.admin).toContain('manage_organization')
    expect(mapResponse.body.admin).toContain('manage_billing')
    expect(mapResponse.body.member).toContain('execute_workflows')

    const myPermissions = await request<{ organizationId?: string; role?: string; isOwner?: boolean; permissions: string[] }>(
      '/v1/permissions/me',
      'permissions-me-owner',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(myPermissions.response.status).toBe(200)
    expect(myPermissions.body.organizationId).toBe(organization.id)
    expect(myPermissions.body.role).toBe('admin')
    expect(myPermissions.body.permissions).toContain('manage_organization')

    const ownerMe = await request<{ organizationId?: string; permissions?: string[] }>(
      '/v1/auth/me',
      'auth-me-permissions-owner',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(ownerMe.response.status).toBe(200)
    expect(ownerMe.body.organizationId).toBe(organization.id)
    expect(ownerMe.body.permissions).toContain('manage_organization')

    const member = await createUser(factoryContext, {
      name: 'Permissions Member'
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

    const memberMe = await request<{ organizationId?: string; permissions?: string[] }>(
      '/v1/auth/me',
      'auth-me-permissions-member',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )

    expect(memberMe.response.status).toBe(200)
    expect(memberMe.body.organizationId).toBe(organization.id)
    expect(memberMe.body.permissions).toContain('execute_workflows')
    expect(memberMe.body.permissions).not.toContain('manage_billing')
  })

  it('resolves permissions/me using the most recent organization membership', async () => {
    const factoryContext = getFactoryContext()

    const user = await createUser(factoryContext, {
      name: 'Permissions Recent Membership'
    })

    const firstOrganization = await createOrganization(factoryContext, {
      token: user.token,
      name: 'Permissions First Organization'
    })

    const secondOrganization = await createOrganization(factoryContext, {
      token: user.token,
      name: 'Permissions Second Organization'
    })

    expect(firstOrganization.id).not.toBe(secondOrganization.id)

    const myPermissions = await request<{ organizationId?: string; role?: string; isOwner?: boolean; permissions: string[] }>(
      '/v1/permissions/me',
      'permissions-me-most-recent-membership',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${user.token}`
        }
      }
    )

    expect(myPermissions.response.status).toBe(200)
    expect(myPermissions.body.organizationId).toBe(secondOrganization.id)
    expect(myPermissions.body.role).toBe('admin')
    expect(myPermissions.body.permissions).toContain('manage_organization')
  })

  it('rejects permissions/me without auth and returns empty permissions without membership', async () => {
    const factoryContext = getFactoryContext()

    const withoutAuth = await request<{ message: string }>(
      '/v1/permissions/me',
      'permissions-me-without-auth',
      {
        method: 'GET'
      }
    )

    expect(withoutAuth.response.status).toBe(401)

    const userWithoutMembership = await createUser(factoryContext, {
      name: 'Permissions No Membership'
    })

    const noMembershipPermissions = await request<{
      organizationId?: string
      role?: string
      permissions: string[]
    }>(
      '/v1/permissions/me',
      'permissions-me-no-membership',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${userWithoutMembership.token}`
        }
      }
    )

    expect(noMembershipPermissions.response.status).toBe(200)
    expect(noMembershipPermissions.body.permissions).toEqual([])
    expect(noMembershipPermissions.body.organizationId).toBeUndefined()
    expect(noMembershipPermissions.body.role).toBeUndefined()
  })
})
