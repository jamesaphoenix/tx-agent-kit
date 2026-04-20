import { randomUUID } from 'node:crypto'
import { createOrganization, createUser, defaultTestBrandSettings } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import {
  createTestFixture
} from './test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { dbAuthContext, request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'api_orgs'
})

// 15 tests using per-test factories — safe to run concurrently against
// the shared integration API server (each call seeds its own user/org).
describe.concurrent('organizations integration', () => {
  it('forbids organization mutation for non-owner members', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `organization-mutation-owner-${uid}@example.com`,
      password: 'owner-pass-12345',
      name: 'Organization Mutation Owner'
    })

    const member = await createUser(factoryContext, {
      email: `organization-mutation-member-${uid}@example.com`,
      password: 'member-pass-12345',
      name: 'Organization Mutation Member'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Organization Mutation Team'
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

    const memberUpdateOrganization = await request<{ message: string }>(
      `/v1/organizations/${organization.id}`,
      'member-update-organization-forbidden',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          name: 'Member Should Not Rename'
        })
      }
    )

    expect(memberUpdateOrganization.response.status).toBe(401)

    const memberDeleteOrganization = await request<{ message: string }>(
      `/v1/organizations/${organization.id}`,
      'member-delete-organization-forbidden',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )

    expect(memberDeleteOrganization.response.status).toBe(401)
  })

  it('returns bad request for invalid list query params', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `invalid-query-owner-${uid}@example.com`,
      password: 'owner-pass-12345',
      name: 'Invalid Query Owner'
    })

    const invalidCases = [
      {
        path: '/v1/organizations?sortBy=unknown',
        caseName: 'invalid-query-organizations-sort-by'
      },
      {
        path: '/v1/invitations?sortBy=unknown',
        caseName: 'invalid-query-invitations-sort-by'
      }
    ] as const

    for (const testCase of invalidCases) {
      const invalidResponse = await request<{ message: string }>(
        testCase.path,
        testCase.caseName,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${owner.token}`
          }
        }
      )

      if (invalidResponse.response.status !== 400) {
        throw new Error(
          `Expected 400 for ${testCase.caseName}, received ${invalidResponse.response.status}`
        )
      }
      expect(invalidResponse.body.message.length).toBeGreaterThan(0)
    }
  })

  it('paginates organization lists with name sorting and cursors', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `organization-pagination-owner-${uid}@example.com`,
      password: 'owner-pass-12345',
      name: 'Organization Pagination Owner'
    })

    for (const [index, name] of ['Charlie Organization', 'Alpha Organization', 'Bravo Organization'].entries()) {
      const created = await request<{ id: string; name: string }>(
        '/v1/organizations',
        `create-organization-pagination-${index + 1}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${owner.token}`
          },
          body: JSON.stringify({ name })
        }
      )

      expect(created.response.status).toBe(201)
    }

    const firstPage = await request<{
      data: Array<{ id: string; name: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      '/v1/organizations?limit=2&sortBy=name&sortOrder=asc',
      'list-organizations-pagination-page-1',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(firstPage.response.status).toBe(200)
    expect(firstPage.body.total).toBe(3)
    expect(firstPage.body.data.map((org) => org.name)).toEqual([
      'Alpha Organization',
      'Bravo Organization'
    ])
    expect(firstPage.body.prevCursor).toBeNull()
    expect(firstPage.body.nextCursor).toBeTruthy()

    const nextCursor = firstPage.body.nextCursor
    if (!nextCursor) {
      throw new Error('Expected next cursor for organization page')
    }

    const secondPage = await request<{
      data: Array<{ id: string; name: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      `/v1/organizations?limit=2&sortBy=name&sortOrder=asc&cursor=${encodeURIComponent(nextCursor)}`,
      'list-organizations-pagination-page-2',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(secondPage.response.status).toBe(200)
    expect(secondPage.body.total).toBe(3)
    expect(secondPage.body.data.map((org) => org.name)).toEqual(['Charlie Organization'])
    expect(secondPage.body.prevCursor).toBeTruthy()
  })

  it('supports batch get-many endpoints for admin data providers', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `batch-owner-${uid}@example.com`,
      password: 'owner-pass-12345',
      name: 'Batch Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: `batch-invitee-${uid}@example.com`,
      password: 'invitee-pass-12345',
      name: 'Batch Invitee'
    })

    const outsideOwner = await createUser(factoryContext, {
      email: `batch-outside-owner-${uid}@example.com`,
      password: 'outside-owner-pass-12345',
      name: 'Batch Outside Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Batch Organization'
    })

    const outsideOrganization = await createOrganization(factoryContext, {
      token: outsideOwner.token,
      name: 'Outside Organization'
    })

    const invitation = await request<{ id: string }>(
      '/v1/invitations',
      'batch-create-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(invitation.response.status).toBe(201)

    const outsideInvitation = await request<{ id: string }>(
      '/v1/invitations',
      'batch-create-outside-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${outsideOwner.token}`
        },
        body: JSON.stringify({
          organizationId: outsideOrganization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(outsideInvitation.response.status).toBe(201)

    const batchOrganizations = await request<{ data: Array<{ id: string }> }>(
      '/v1/organizations/batch/get-many',
      'batch-get-many-organizations',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: [outsideOrganization.id, organization.id]
        })
      }
    )

    expect(batchOrganizations.response.status).toBe(200)
    expect(batchOrganizations.body.data.map((item) => item.id)).toEqual([organization.id])

    const batchInvitations = await request<{ data: Array<{ id: string }> }>(
      '/v1/invitations/batch/get-many',
      'batch-get-many-invitations',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: [outsideInvitation.body.id, invitation.body.id]
        })
      }
    )

    expect(batchInvitations.response.status).toBe(200)
    expect(batchInvitations.body.data.map((item) => item.id)).toEqual([invitation.body.id])

    const invalidOrganizationBatchBody = await request<{ message: string }>(
      '/v1/organizations/batch/get-many',
      'batch-get-many-invalid-uuid-organizations',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: ['not-a-uuid']
        })
      }
    )

    expect(invalidOrganizationBatchBody.response.status).toBe(400)
    expect(invalidOrganizationBatchBody.body.message.length).toBeGreaterThan(0)

    const invalidInvitationBatchBody = await request<{ message: string }>(
      '/v1/invitations/batch/get-many',
      'batch-get-many-invalid-uuid-invitations',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          ids: ['not-a-uuid']
        })
      }
    )

    expect(invalidInvitationBatchBody.response.status).toBe(400)
    expect(invalidInvitationBatchBody.body.message.length).toBeGreaterThan(0)
  })

  it('supports detail, update, and delete lifecycle endpoints for organization and invitation [INV-TEN-010]', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `crud-lifecycle-owner-${uid}@example.com`,
      password: 'owner-pass-12345',
      name: 'CRUD Lifecycle Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: `crud-lifecycle-invitee-${uid}@example.com`,
      password: 'invitee-pass-12345',
      name: 'CRUD Lifecycle Invitee'
    })

    const createdOrganization = await request<{ id: string; name: string }>(
      '/v1/organizations',
      'crud-lifecycle-create-organization',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'CRUD Lifecycle Organization'
        })
      }
    )

    expect(createdOrganization.response.status).toBe(201)

    const organizationId = createdOrganization.body.id

    const organizationById = await request<{ id: string; name: string }>(
      `/v1/organizations/${organizationId}`,
      'crud-lifecycle-get-organization',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(organizationById.response.status).toBe(200)
    expect(organizationById.body.id).toBe(organizationId)

    const updatedOrganization = await request<{ id: string; name: string }>(
      `/v1/organizations/${organizationId}`,
      'crud-lifecycle-update-organization',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'CRUD Lifecycle Organization Updated'
        })
      }
    )

    expect(updatedOrganization.response.status).toBe(200)
    expect(updatedOrganization.body.name).toBe('CRUD Lifecycle Organization Updated')

    const createdInvitation = await request<{
      id: string
      organizationId: string
      email: string
      role: 'admin' | 'member'
      status: 'pending' | 'accepted' | 'revoked' | 'expired'
    }>(
      '/v1/invitations',
      'crud-lifecycle-create-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    const invitationId = createdInvitation.body.id

    const invitationById = await request<{
      id: string
      organizationId: string
      role: 'admin' | 'member'
      status: 'pending' | 'accepted' | 'revoked' | 'expired'
    }>(
      `/v1/invitations/${invitationId}`,
      'crud-lifecycle-get-invitation',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(invitationById.response.status).toBe(200)
    expect(invitationById.body.id).toBe(invitationId)
    expect(invitationById.body.organizationId).toBe(organizationId)
    expect(invitationById.body.status).toBe('pending')

    const updatedInvitation = await request<{
      id: string
      role: 'admin' | 'member'
      status: 'pending' | 'accepted' | 'revoked' | 'expired'
    }>(
      `/v1/invitations/${invitationId}`,
      'crud-lifecycle-update-invitation',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          role: 'admin',
          status: 'revoked'
        })
      }
    )

    expect(updatedInvitation.response.status).toBe(200)
    expect(updatedInvitation.body.role).toBe('admin')
    expect(updatedInvitation.body.status).toBe('revoked')

    const removedInvitation = await request<{ deleted: boolean }>(
      `/v1/invitations/${invitationId}`,
      'crud-lifecycle-remove-invitation',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(removedInvitation.response.status).toBe(200)
    expect(removedInvitation.body.deleted).toBe(true)

    const invitationAfterRemove = await request<{ id: string; status: string }>(
      `/v1/invitations/${invitationId}`,
      'crud-lifecycle-get-invitation-after-delete',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(invitationAfterRemove.response.status).toBe(200)
    expect(invitationAfterRemove.body.id).toBe(invitationId)
    expect(invitationAfterRemove.body.status).toBe('revoked')

    const removedOrganization = await request<{ deleted: boolean }>(
      `/v1/organizations/${organizationId}`,
      'crud-lifecycle-remove-organization',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(removedOrganization.response.status).toBe(200)
    expect(removedOrganization.body.deleted).toBe(true)

    const organizationAfterRemove = await request<{ message: string }>(
      `/v1/organizations/${organizationId}`,
      'crud-lifecycle-get-organization-after-delete',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(organizationAfterRemove.response.status).toBe(404)
  })

  it('auto-creates owner membership when organization is created via API', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `organization-owner-trigger-${uid}@example.com`,
      password: 'owner-pass-12345',
      name: 'Organization Trigger Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Organization Trigger Team'
    })

    const membershipResult = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      client.query<{ role: string }>(
        `
          SELECT role
          FROM org_members
          WHERE organization_id = $1
            AND user_id = $2
          LIMIT 1
        `,
        [organization.id, owner.user.id]
      )
    )

    expect(membershipResult.rows).toHaveLength(1)
    expect(membershipResult.rows[0]?.role).toBe('admin')
  })

  it('lists invitations for invitee email and not organization membership', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-${uid}@example.com`,
      password: 'strong-pass-12345',
      name: 'Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-${uid}@example.com`,
      password: 'strong-pass-12345',
      name: 'Invitee'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Scope Organization'
    })

    const createdInvitation = await request<{ id: string; token: string; email: string }>(
      '/v1/invitations',
      'create-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    const ownerInvitations = await request<{ data: Array<{ id: string }> }>(
      '/v1/invitations',
      'list-owner-invitations',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(ownerInvitations.response.status).toBe(200)
    expect(ownerInvitations.body.data).toHaveLength(0)

    const inviteeInvitations = await request<{ data: Array<{ id: string; token: string; email: string }> }>(
      '/v1/invitations',
      'list-invitee-invitations',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(inviteeInvitations.response.status).toBe(200)
    expect(inviteeInvitations.body.data).toHaveLength(1)
    expect(inviteeInvitations.body.data[0]?.id).toBe(createdInvitation.body.id)
    expect(inviteeInvitations.body.data[0]?.token).toBe(createdInvitation.body.token)
    expect(inviteeInvitations.body.data[0]?.email).toBe(invitee.user.email)
  })

  it('supports invitation list filtering and expiresAt sorting', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-invite-filter-${uid}@example.com`,
      password: 'owner-pass-12345',
      name: 'Owner Invite Filter'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-invite-filter-${uid}@example.com`,
      password: 'invitee-pass-12345',
      name: 'Invitee Invite Filter'
    })

    const organizationOne = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Filter Organization One'
    })

    const organizationTwo = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Filter Organization Two'
    })

    const memberInvitation = await request<{ id: string }>(
      '/v1/invitations',
      'create-invitation-filter-member',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organizationOne.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    const adminInvitation = await request<{ id: string }>(
      '/v1/invitations',
      'create-invitation-filter-admin',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organizationTwo.id,
          email: invitee.user.email,
          role: 'admin'
        })
      }
    )

    expect(memberInvitation.response.status).toBe(201)
    expect(adminInvitation.response.status).toBe(201)

    const revokeAdminInvitation = await request<{ id: string; status: string }>(
      `/v1/invitations/${adminInvitation.body.id}`,
      'update-invitation-filter-admin-revoked',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          status: 'revoked'
        })
      }
    )

    expect(revokeAdminInvitation.response.status).toBe(200)
    expect(revokeAdminInvitation.body.status).toBe('revoked')

    const roleFiltered = await request<{
      data: Array<{ id: string; role: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      '/v1/invitations?filter[role]=admin',
      'list-invitations-filter-role-admin',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(roleFiltered.response.status).toBe(200)
    expect(roleFiltered.body.total).toBe(1)
    expect(roleFiltered.body.data[0]?.id).toBe(adminInvitation.body.id)

    const statusFiltered = await request<{
      data: Array<{ id: string; status: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      '/v1/invitations?filter[status]=revoked',
      'list-invitations-filter-status-revoked',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(statusFiltered.response.status).toBe(200)
    expect(statusFiltered.body.total).toBe(1)
    expect(statusFiltered.body.data[0]?.id).toBe(adminInvitation.body.id)
    expect(statusFiltered.body.data[0]?.status).toBe('revoked')

    const sortedByExpiresAt = await request<{
      data: Array<{ id: string }>
      total: number
      nextCursor: string | null
      prevCursor: string | null
    }>(
      '/v1/invitations?sortBy=expiresAt&sortOrder=asc',
      'list-invitations-sort-expires-at',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(sortedByExpiresAt.response.status).toBe(200)
    expect(sortedByExpiresAt.body.total).toBe(2)
    expect(sortedByExpiresAt.body.data).toHaveLength(2)
  })

  it('requires admin privileges for invites and supports invite-before-signup by email [INV-TEN-009A] [INV-REQ-TENANCY-MODEL-005]', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-roles-${uid}@example.com`,
      password: 'strong-pass-12345',
      name: 'Owner Roles'
    })

    const member = await createUser(factoryContext, {
      email: `member-roles-${uid}@example.com`,
      password: 'strong-pass-12345',
      name: 'Member Roles'
    })

    const target = await createUser(factoryContext, {
      email: `target-roles-${uid}@example.com`,
      password: 'strong-pass-12345',
      name: 'Target Roles'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Role Guard Organization'
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

    const memberInviteAttempt = await request<{ message: string }>(
      '/v1/invitations',
      'member-create-invitation-forbidden',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${member.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: target.user.email,
          role: 'member'
        })
      }
    )

    expect(memberInviteAttempt.response.status).toBe(401)

    const invitedBeforeSignupEmail = `not-registered-${uid}@example.com`
    const ownerEmailOnlyInvite = await request<{
      id: string
      token: string
      email: string
      inviteeUserId: string | null
    }>(
      '/v1/invitations',
      'owner-create-invitation-before-signup',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitedBeforeSignupEmail,
          role: 'member'
        })
      }
    )

    expect(ownerEmailOnlyInvite.response.status).toBe(201)
    expect(ownerEmailOnlyInvite.body.email).toBe(invitedBeforeSignupEmail)

    const createdInviteeUserId = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ invitee_user_id: string | null }>(
        'SELECT invitee_user_id FROM invitations WHERE id = $1',
        [ownerEmailOnlyInvite.body.id]
      )

      return result.rows[0]?.invitee_user_id
    })

    expect(createdInviteeUserId).toBeNull()

    const invitee = await createUser(factoryContext, {
      email: invitedBeforeSignupEmail,
      password: 'invite-before-signup-pass-12345',
      name: 'Invite Before Signup'
    })

    const inviteeInvitations = await request<{ data: Array<{ id: string; token: string; email: string }> }>(
      '/v1/invitations',
      'list-email-only-invitations-after-signup',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(inviteeInvitations.response.status).toBe(200)
    expect(inviteeInvitations.body.data.some((invitation) => invitation.id === ownerEmailOnlyInvite.body.id)).toBe(true)

    const accepted = await request<{ accepted: boolean }>(
      `/v1/invitations/${ownerEmailOnlyInvite.body.token}/accept`,
      'accept-email-only-invitation-after-signup',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(accepted.response.status).toBe(200)
    expect(accepted.body.accepted).toBe(true)

    const membershipCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT count(*) AS count
          FROM org_members
          WHERE organization_id = $1 AND user_id = $2 AND role = 'member'
        `,
        [organization.id, invitee.user.id]
      )

      return Number(result.rows[0]?.count ?? 0)
    })

    expect(membershipCount).toBe(1)
  })

  it('email-only invitations cannot be listed or accepted by a different authenticated user [INV-TEN-009A] [INV-REQ-TENANCY-MODEL-006]', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-email-safe-invite-${uid}@example.com`,
      password: 'owner-email-safe-invite-pass-12345',
      name: 'Owner Email Safe Invite'
    })

    const wrongUser = await createUser(factoryContext, {
      email: `wrong-email-safe-invite-${uid}@example.com`,
      password: 'wrong-email-safe-invite-pass-12345',
      name: 'Wrong Email Safe Invite'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Email Safe Invite Organization'
    })

    const invitedBeforeSignupEmail = `email-safe-invitee-${uid}@example.com`
    const createdInvitation = await request<{
      id: string
      token: string
    }>(
      '/v1/invitations',
      'create-email-safe-invitation-before-signup',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitedBeforeSignupEmail,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    const initialInviteeUserId = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ invitee_user_id: string | null }>(
        'SELECT invitee_user_id FROM invitations WHERE id = $1',
        [createdInvitation.body.id]
      )

      return result.rows[0]?.invitee_user_id
    })

    expect(initialInviteeUserId).toBeNull()

    const wrongUserInvitations = await request<{ data: Array<{ id: string }> }>(
      '/v1/invitations',
      'list-email-safe-invitations-wrong-user',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${wrongUser.token}`
        }
      }
    )

    expect(wrongUserInvitations.response.status).toBe(200)
    expect(wrongUserInvitations.body.data.some((invitation) => invitation.id === createdInvitation.body.id)).toBe(false)

    const wrongUserAccept = await request<{ message: string }>(
      `/v1/invitations/${createdInvitation.body.token}/accept`,
      'accept-email-safe-invitation-wrong-user',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${wrongUser.token}`
        }
      }
    )

    expect(wrongUserAccept.response.status).toBe(404)

    const matchingInvitee = await createUser(factoryContext, {
      email: invitedBeforeSignupEmail,
      password: 'matching-email-safe-invite-pass-12345',
      name: 'Matching Email Safe Invite'
    })

    const matchingInvitations = await request<{ data: Array<{ id: string }> }>(
      '/v1/invitations',
      'list-email-safe-invitations-matching-user',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${matchingInvitee.token}`
        }
      }
    )

    expect(matchingInvitations.response.status).toBe(200)
    expect(matchingInvitations.body.data.some((invitation) => invitation.id === createdInvitation.body.id)).toBe(true)

    const matchingAccept = await request<{ accepted: boolean }>(
      `/v1/invitations/${createdInvitation.body.token}/accept`,
      'accept-email-safe-invitation-matching-user',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${matchingInvitee.token}`
        }
      }
    )

    expect(matchingAccept.response.status).toBe(200)
    expect(matchingAccept.body.accepted).toBe(true)

    const boundInviteeUserId = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ invitee_user_id: string | null }>(
        'SELECT invitee_user_id FROM invitations WHERE id = $1',
        [createdInvitation.body.id]
      )

      return result.rows[0]?.invitee_user_id
    })

    expect(boundInviteeUserId).toBe(matchingInvitee.user.id)
  })

  it('carries client collaborator membership type from invitation creation into acceptance', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-client-invite-${uid}@example.com`,
      password: 'owner-client-invite-pass-12345',
      name: 'Owner Client Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-client-invite-${uid}@example.com`,
      password: 'invitee-client-invite-pass-12345',
      name: 'Invitee Client Invite'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Client Collaborator Invite Organization'
    })

    const team = await request<{ id: string }>(
      '/v1/teams',
      'create-client-collaborator-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Client Collaborator Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(team.response.status).toBe(201)

    const createdInvitation = await request<{ token: string; membershipType: string; teamId: string | null }>(
      '/v1/invitations',
      'create-client-collaborator-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          teamId: team.body.id,
          membershipType: 'client'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)
    expect(createdInvitation.body.membershipType).toBe('client')
    expect(createdInvitation.body.teamId).toBe(team.body.id)

    const listedInvitations = await request<{ data: Array<{ email: string; membershipType: string; teamId: string | null }> }>(
      `/v1/organizations/${organization.id}/invitations?filter[status]=pending`,
      'list-client-collaborator-invitation',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(listedInvitations.response.status).toBe(200)
    const listedInvitation = listedInvitations.body.data.find((invitation) => invitation.email === invitee.user.email)
    expect(listedInvitation?.membershipType).toBe('client')
    expect(listedInvitation?.teamId).toBe(team.body.id)

    const acceptedInvitation = await request<{ accepted: boolean }>(
      `/v1/invitations/${createdInvitation.body.token}/accept`,
      'accept-client-collaborator-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(acceptedInvitation.response.status).toBe(200)
    expect(acceptedInvitation.body.accepted).toBe(true)

    const acceptedState = await factoryContext.testContext.withSchemaClient(async (client) => {
      const membershipResult = await client.query<{ membership_type: string }>(
        `
          SELECT membership_type
          FROM org_members
          WHERE organization_id = $1 AND user_id = $2
          LIMIT 1
        `,
        [organization.id, invitee.user.id]
      )

      const teamMemberResult = await client.query<{ count: string | number }>(
        `
          SELECT count(*) AS count
          FROM team_members
          WHERE team_id = $1 AND user_id = $2 AND disabled_at IS NULL
        `,
        [team.body.id, invitee.user.id]
      )

      return {
        membershipType: membershipResult.rows[0]?.membership_type,
        teamMemberCount: Number(teamMemberResult.rows[0]?.count ?? 0)
      }
    })

    expect(acceptedState.membershipType).toBe('client')
    expect(acceptedState.teamMemberCount).toBe(1)
  })

  it('rejects scoped invitations when the workspace belongs to a different organization', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-cross-org-invite-${uid}@example.com`,
      password: 'owner-cross-org-invite-pass-12345',
      name: 'Owner Cross Org Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-cross-org-invite-${uid}@example.com`,
      password: 'invitee-cross-org-invite-pass-12345',
      name: 'Invitee Cross Org Invite'
    })

    const firstOrganization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Cross Org Invite First Organization'
    })
    const secondOrganization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Cross Org Invite Second Organization'
    })

    const foreignTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-cross-org-invite-foreign-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: secondOrganization.id,
          name: 'Cross Org Invite Foreign Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(foreignTeam.response.status).toBe(201)

    const rejectedInvitation = await request<{ message: string }>(
      '/v1/invitations',
      'create-cross-org-scoped-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: firstOrganization.id,
          email: invitee.user.email,
          role: 'member',
          teamId: foreignTeam.body.id,
          membershipType: 'client'
        })
      }
    )

    expect(rejectedInvitation.response.status).toBe(400)
    expect(rejectedInvitation.body.message).toContain('Workspace does not belong to organization')
  })

  it('rejects client collaborator invitations that are not scoped to a workspace', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-client-orgwide-invite-${uid}@example.com`,
      password: 'owner-client-orgwide-invite-pass-12345',
      name: 'Owner Client Orgwide Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-client-orgwide-invite-${uid}@example.com`,
      password: 'invitee-client-orgwide-invite-pass-12345',
      name: 'Invitee Client Orgwide Invite'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Client Orgwide Invite Organization'
    })

    const rejectedInvitation = await request<{ message: string }>(
      '/v1/invitations',
      'create-client-orgwide-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          membershipType: 'client'
        })
      }
    )

    expect(rejectedInvitation.response.status).toBe(400)
    expect(rejectedInvitation.body.message).toContain('Client collaborator invitations must target a workspace')
  })

  it('accepts multiple scoped client collaborator invitations for the same email', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-client-multi-invite-${uid}@example.com`,
      password: 'owner-client-multi-invite-pass-12345',
      name: 'Owner Client Multi Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-client-multi-invite-${uid}@example.com`,
      password: 'invitee-client-multi-invite-pass-12345',
      name: 'Invitee Client Multi Invite'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Client Multi Invite Organization'
    })

    const firstTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-client-multi-first-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Client Multi First Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    const secondTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-client-multi-second-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Client Multi Second Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(firstTeam.response.status).toBe(201)
    expect(secondTeam.response.status).toBe(201)

    const firstInvitation = await request<{ token: string; teamId: string | null }>(
      '/v1/invitations',
      'create-client-multi-first-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          teamId: firstTeam.body.id,
          membershipType: 'client'
        })
      }
    )
    const secondInvitation = await request<{ token: string; teamId: string | null }>(
      '/v1/invitations',
      'create-client-multi-second-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          teamId: secondTeam.body.id,
          membershipType: 'client'
        })
      }
    )

    expect(firstInvitation.response.status).toBe(201)
    expect(secondInvitation.response.status).toBe(201)

    const [firstAccepted, secondAccepted] = await Promise.all([
      request<{ accepted: boolean }>(
        `/v1/invitations/${firstInvitation.body.token}/accept`,
        'accept-client-multi-first-invitation',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${invitee.token}`
          }
        }
      ),
      request<{ accepted: boolean }>(
        `/v1/invitations/${secondInvitation.body.token}/accept`,
        'accept-client-multi-second-invitation',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${invitee.token}`
          }
        }
      )
    ])

    expect(firstAccepted.response.status).toBe(200)
    expect(secondAccepted.response.status).toBe(200)
    expect(firstAccepted.body.accepted).toBe(true)
    expect(secondAccepted.body.accepted).toBe(true)

    const acceptedState = await factoryContext.testContext.withSchemaClient(async (client) => {
      const membershipResult = await client.query<{ membership_type: string; count: string | number }>(
        `
          SELECT membership_type, count(*) OVER () AS count
          FROM org_members
          WHERE organization_id = $1 AND user_id = $2
        `,
        [organization.id, invitee.user.id]
      )

      const teamMemberResult = await client.query<{ team_id: string }>(
        `
          SELECT team_id
          FROM team_members
          WHERE team_id = ANY($1::uuid[]) AND user_id = $2 AND disabled_at IS NULL
          ORDER BY team_id ASC
        `,
        [[firstTeam.body.id, secondTeam.body.id], invitee.user.id]
      )

      return {
        membershipType: membershipResult.rows[0]?.membership_type,
        membershipCount: Number(membershipResult.rows[0]?.count ?? 0),
        teamIds: teamMemberResult.rows.map((row) => row.team_id)
      }
    })

    expect(acceptedState.membershipType).toBe('client')
    expect(acceptedState.membershipCount).toBe(1)
    expect(acceptedState.teamIds.sort()).toEqual([firstTeam.body.id, secondTeam.body.id].sort())
  })

  it('enforces pending invitation uniqueness per organization email and workspace scope', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-pending-scope-unique-${uid}@example.com`,
      password: 'owner-pending-scope-unique-pass-12345',
      name: 'Owner Pending Scope Unique'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-pending-scope-unique-${uid}@example.com`,
      password: 'invitee-pending-scope-unique-pass-12345',
      name: 'Invitee Pending Scope Unique'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Pending Scope Unique Organization'
    })

    const firstTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-pending-scope-unique-first-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Pending Scope Unique First Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    const secondTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-pending-scope-unique-second-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Pending Scope Unique Second Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(firstTeam.response.status).toBe(201)
    expect(secondTeam.response.status).toBe(201)

    const orgWideInvitation = await request<{ id: string }>(
      '/v1/invitations',
      'create-pending-scope-unique-orgwide-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          membershipType: 'team'
        })
      }
    )
    const duplicateOrgWideInvitation = await request<{ message: string }>(
      '/v1/invitations',
      'create-pending-scope-unique-duplicate-orgwide-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'admin',
          membershipType: 'team'
        })
      }
    )
    const firstScopedInvitation = await request<{ id: string; teamId: string | null }>(
      '/v1/invitations',
      'create-pending-scope-unique-first-scoped-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          teamId: firstTeam.body.id,
          membershipType: 'client'
        })
      }
    )
    const duplicateFirstScopedInvitation = await request<{ message: string }>(
      '/v1/invitations',
      'create-pending-scope-unique-duplicate-first-scoped-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'admin',
          teamId: firstTeam.body.id,
          membershipType: 'client'
        })
      }
    )
    const secondScopedInvitation = await request<{ id: string; teamId: string | null }>(
      '/v1/invitations',
      'create-pending-scope-unique-second-scoped-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          teamId: secondTeam.body.id,
          membershipType: 'client'
        })
      }
    )

    expect(orgWideInvitation.response.status).toBe(201)
    expect(duplicateOrgWideInvitation.response.status).toBe(409)
    expect(duplicateOrgWideInvitation.body.message).toContain('A pending organization invitation already exists for this email')
    expect(firstScopedInvitation.response.status).toBe(201)
    expect(firstScopedInvitation.body.teamId).toBe(firstTeam.body.id)
    expect(duplicateFirstScopedInvitation.response.status).toBe(409)
    expect(duplicateFirstScopedInvitation.body.message).toContain('A pending invitation already exists for this email and workspace')
    expect(secondScopedInvitation.response.status).toBe(201)
    expect(secondScopedInvitation.body.teamId).toBe(secondTeam.body.id)
  })

  it('returns deterministic conflict for concurrent duplicate scoped invitations', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-concurrent-scoped-invite-${uid}@example.com`,
      password: 'owner-concurrent-scoped-invite-pass-12345',
      name: 'Owner Concurrent Scoped Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-concurrent-scoped-invite-${uid}@example.com`,
      password: 'invitee-concurrent-scoped-invite-pass-12345',
      name: 'Invitee Concurrent Scoped Invite'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Concurrent Scoped Invite Organization'
    })

    const team = await request<{ id: string }>(
      '/v1/teams',
      'create-concurrent-scoped-invite-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Concurrent Scoped Invite Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(team.response.status).toBe(201)

    const invitePayload = {
      organizationId: organization.id,
      email: invitee.user.email,
      role: 'member',
      teamId: team.body.id,
      membershipType: 'client'
    } as const

    const [firstAttempt, secondAttempt] = await Promise.all([
      request<{ id?: string; message?: string }>(
        '/v1/invitations',
        'create-concurrent-scoped-invite-first-attempt',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${owner.token}`
          },
          body: JSON.stringify(invitePayload)
        }
      ),
      request<{ id?: string; message?: string }>(
        '/v1/invitations',
        'create-concurrent-scoped-invite-second-attempt',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${owner.token}`
          },
          body: JSON.stringify(invitePayload)
        }
      )
    ])

    const statuses = [firstAttempt.response.status, secondAttempt.response.status].sort((left, right) => left - right)
    expect(statuses).toEqual([201, 409])

    const conflictAttempt = [firstAttempt, secondAttempt].find((attempt) => attempt.response.status === 409)
    expect(conflictAttempt?.body.message).toContain('A pending invitation already exists for this email and workspace')

    const pendingInviteCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT count(*) AS count
          FROM invitations
          WHERE organization_id = $1
            AND email = $2
            AND team_id = $3
            AND status = 'pending'
        `,
        [organization.id, invitee.user.email, team.body.id]
      )

      return Number(result.rows[0]?.count ?? 0)
    })

    expect(pendingInviteCount).toBe(1)
  })

  it('allows recreating the same scoped pending invitation after the previous one is revoked', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-recreate-revoked-scoped-${uid}@example.com`,
      password: 'owner-recreate-revoked-scoped-pass-12345',
      name: 'Owner Recreate Revoked Scoped'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-recreate-revoked-scoped-${uid}@example.com`,
      password: 'invitee-recreate-revoked-scoped-pass-12345',
      name: 'Invitee Recreate Revoked Scoped'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Recreate Revoked Scoped Organization'
    })

    const team = await request<{ id: string }>(
      '/v1/teams',
      'create-recreate-revoked-scoped-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Recreate Revoked Scoped Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(team.response.status).toBe(201)

    const firstInvitation = await request<{ id: string }>(
      '/v1/invitations',
      'create-recreate-revoked-scoped-first-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          teamId: team.body.id,
          membershipType: 'client'
        })
      }
    )

    expect(firstInvitation.response.status).toBe(201)

    const revokedInvitation = await request<{ deleted: boolean }>(
      `/v1/invitations/${firstInvitation.body.id}`,
      'revoke-recreate-revoked-scoped-first-invitation',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(revokedInvitation.response.status).toBe(200)
    expect(revokedInvitation.body.deleted).toBe(true)

    const secondInvitation = await request<{ id: string; teamId: string | null }>(
      '/v1/invitations',
      'create-recreate-revoked-scoped-second-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          teamId: team.body.id,
          membershipType: 'client'
        })
      }
    )

    expect(secondInvitation.response.status).toBe(201)
    expect(secondInvitation.body.id).not.toBe(firstInvitation.body.id)
    expect(secondInvitation.body.teamId).toBe(team.body.id)
  })

  it('accepting a scoped internal teammate invitation only grants the selected workspace', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-scoped-internal-invite-${uid}@example.com`,
      password: 'owner-scoped-internal-invite-pass-12345',
      name: 'Owner Scoped Internal Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-scoped-internal-invite-${uid}@example.com`,
      password: 'invitee-scoped-internal-invite-pass-12345',
      name: 'Invitee Scoped Internal Invite'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Scoped Internal Invite Organization'
    })

    const firstTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-scoped-internal-first-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Scoped Internal First Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    const secondTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-scoped-internal-second-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Scoped Internal Second Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(firstTeam.response.status).toBe(201)
    expect(secondTeam.response.status).toBe(201)

    const invitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-scoped-internal-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          teamId: firstTeam.body.id,
          membershipType: 'team'
        })
      }
    )

    expect(invitation.response.status).toBe(201)

    const accepted = await request<{ accepted: boolean }>(
      `/v1/invitations/${invitation.body.token}/accept`,
      'accept-scoped-internal-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(accepted.response.status).toBe(200)

    const acceptedState = await factoryContext.testContext.withSchemaClient(async (client) => {
      const teamMemberResult = await client.query<{ team_id: string }>(
        `
          SELECT team_id
          FROM team_members
          WHERE team_id = ANY($1::uuid[]) AND user_id = $2 AND disabled_at IS NULL
          ORDER BY team_id ASC
        `,
        [[firstTeam.body.id, secondTeam.body.id], invitee.user.id]
      )

      return {
        teamIds: teamMemberResult.rows.map((row) => row.team_id)
      }
    })

    expect(acceptedState.teamIds).toEqual([firstTeam.body.id])
  })

  it('keeps future workspace auto-join limited to org-wide internal teammate invitations', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-future-scope-invite-${uid}@example.com`,
      password: 'owner-future-scope-invite-pass-12345',
      name: 'Owner Future Scope Invite'
    })

    const orgWideInvitee = await createUser(factoryContext, {
      email: `orgwide-future-scope-invitee-${uid}@example.com`,
      password: 'orgwide-future-scope-invitee-pass-12345',
      name: 'Orgwide Future Scope Invitee'
    })

    const scopedInvitee = await createUser(factoryContext, {
      email: `scoped-future-scope-invitee-${uid}@example.com`,
      password: 'scoped-future-scope-invitee-pass-12345',
      name: 'Scoped Future Scope Invitee'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Future Scope Invite Organization'
    })

    const initialTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-future-scope-initial-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Future Scope Initial Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(initialTeam.response.status).toBe(201)

    const orgWideInvitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-future-scope-orgwide-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: orgWideInvitee.user.email,
          role: 'member',
          membershipType: 'team'
        })
      }
    )
    const scopedInvitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-future-scope-scoped-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: scopedInvitee.user.email,
          role: 'member',
          teamId: initialTeam.body.id,
          membershipType: 'team'
        })
      }
    )

    expect(orgWideInvitation.response.status).toBe(201)
    expect(scopedInvitation.response.status).toBe(201)

    const orgWideAccepted = await request<{ accepted: boolean }>(
      `/v1/invitations/${orgWideInvitation.body.token}/accept`,
      'accept-future-scope-orgwide-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${orgWideInvitee.token}`
        }
      }
    )
    const scopedAccepted = await request<{ accepted: boolean }>(
      `/v1/invitations/${scopedInvitation.body.token}/accept`,
      'accept-future-scope-scoped-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${scopedInvitee.token}`
        }
      }
    )

    expect(orgWideAccepted.response.status).toBe(200)
    expect(scopedAccepted.response.status).toBe(200)

    const futureTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-future-scope-future-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Future Scope Later Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(futureTeam.response.status).toBe(201)

    const acceptedState = await factoryContext.testContext.withSchemaClient(async (client) => {
      const teamMemberResult = await client.query<{ team_id: string; user_id: string }>(
        `
          SELECT team_id, user_id
          FROM team_members
          WHERE team_id = ANY($1::uuid[])
            AND user_id = ANY($2::uuid[])
            AND disabled_at IS NULL
          ORDER BY user_id ASC, team_id ASC
        `,
        [
          [initialTeam.body.id, futureTeam.body.id],
          [orgWideInvitee.user.id, scopedInvitee.user.id]
        ]
      )

      return teamMemberResult.rows.map((row) => `${row.user_id}:${row.team_id}`)
    })

    expect(acceptedState).toEqual(expect.arrayContaining([
      `${orgWideInvitee.user.id}:${initialTeam.body.id}`,
      `${orgWideInvitee.user.id}:${futureTeam.body.id}`,
      `${scopedInvitee.user.id}:${initialTeam.body.id}`
    ]))
    expect(acceptedState).not.toContain(`${scopedInvitee.user.id}:${futureTeam.body.id}`)
  })

  it('upgrades access deterministically when multiple pending invitations are accepted in different orders', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-mixed-invite-${uid}@example.com`,
      password: 'owner-mixed-invite-pass-12345',
      name: 'Owner Mixed Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-mixed-invite-${uid}@example.com`,
      password: 'invitee-mixed-invite-pass-12345',
      name: 'Invitee Mixed Invite'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Mixed Invite Organization'
    })

    const team = await request<{ id: string }>(
      '/v1/teams',
      'create-mixed-invite-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Mixed Invite Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(team.response.status).toBe(201)

    const orgWideMemberInvitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-mixed-org-wide-member-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          membershipType: 'team'
        })
      }
    )
    const scopedAdminInvitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-mixed-scoped-admin-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'admin',
          teamId: team.body.id,
          membershipType: 'client'
        })
      }
    )

    expect(orgWideMemberInvitation.response.status).toBe(201)
    expect(scopedAdminInvitation.response.status).toBe(201)

    const orgWideAccepted = await request<{ accepted: boolean }>(
      `/v1/invitations/${orgWideMemberInvitation.body.token}/accept`,
      'accept-mixed-org-wide-member-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )
    const scopedAccepted = await request<{ accepted: boolean }>(
      `/v1/invitations/${scopedAdminInvitation.body.token}/accept`,
      'accept-mixed-scoped-admin-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(orgWideAccepted.response.status).toBe(200)
    expect(scopedAccepted.response.status).toBe(200)
    expect(orgWideAccepted.body.accepted).toBe(true)
    expect(scopedAccepted.body.accepted).toBe(true)

    const acceptedState = await factoryContext.testContext.withSchemaClient(async (client) => {
      const membershipResult = await client.query<{ role: string; membership_type: string; count: string | number }>(
        `
          SELECT role, membership_type, count(*) OVER () AS count
          FROM org_members
          WHERE organization_id = $1 AND user_id = $2
        `,
        [organization.id, invitee.user.id]
      )

      const teamMemberResult = await client.query<{ role: string }>(
        `
          SELECT role
          FROM team_members
          WHERE team_id = $1 AND user_id = $2 AND disabled_at IS NULL
          LIMIT 1
        `,
        [team.body.id, invitee.user.id]
      )

      return {
        orgRole: membershipResult.rows[0]?.role,
        membershipType: membershipResult.rows[0]?.membership_type,
        membershipCount: Number(membershipResult.rows[0]?.count ?? 0),
        teamRole: teamMemberResult.rows[0]?.role
      }
    })

    expect(acceptedState.orgRole).toBe('admin')
    expect(acceptedState.membershipType).toBe('team')
    expect(acceptedState.membershipCount).toBe(1)
    expect(acceptedState.teamRole).toBe('admin')
  })

  it('preserves the highest scoped workspace role when a scoped invite is accepted before an org-wide invite', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-reverse-mixed-invite-${uid}@example.com`,
      password: 'owner-reverse-mixed-invite-pass-12345',
      name: 'Owner Reverse Mixed Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-reverse-mixed-invite-${uid}@example.com`,
      password: 'invitee-reverse-mixed-invite-pass-12345',
      name: 'Invitee Reverse Mixed Invite'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Reverse Mixed Invite Organization'
    })

    const adminTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-reverse-mixed-admin-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Reverse Mixed Admin Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    const memberTeam = await request<{ id: string }>(
      '/v1/teams',
      'create-reverse-mixed-member-workspace',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Reverse Mixed Member Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(adminTeam.response.status).toBe(201)
    expect(memberTeam.response.status).toBe(201)

    const scopedAdminInvitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-reverse-mixed-scoped-admin-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'admin',
          teamId: adminTeam.body.id,
          membershipType: 'client'
        })
      }
    )
    const orgWideMemberInvitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-reverse-mixed-org-wide-member-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member',
          membershipType: 'team'
        })
      }
    )

    expect(scopedAdminInvitation.response.status).toBe(201)
    expect(orgWideMemberInvitation.response.status).toBe(201)

    const scopedAccepted = await request<{ accepted: boolean }>(
      `/v1/invitations/${scopedAdminInvitation.body.token}/accept`,
      'accept-reverse-mixed-scoped-admin-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )
    const orgWideAccepted = await request<{ accepted: boolean }>(
      `/v1/invitations/${orgWideMemberInvitation.body.token}/accept`,
      'accept-reverse-mixed-org-wide-member-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(scopedAccepted.response.status).toBe(200)
    expect(orgWideAccepted.response.status).toBe(200)

    const acceptedState = await factoryContext.testContext.withSchemaClient(async (client) => {
      const membershipResult = await client.query<{ role: string; membership_type: string; count: string | number }>(
        `
          SELECT role, membership_type, count(*) OVER () AS count
          FROM org_members
          WHERE organization_id = $1 AND user_id = $2
        `,
        [organization.id, invitee.user.id]
      )

      const teamMemberResult = await client.query<{ team_id: string; role: string }>(
        `
          SELECT team_id, role
          FROM team_members
          WHERE team_id = ANY($1::uuid[]) AND user_id = $2 AND disabled_at IS NULL
          ORDER BY team_id ASC
        `,
        [[adminTeam.body.id, memberTeam.body.id], invitee.user.id]
      )

      return {
        orgRole: membershipResult.rows[0]?.role,
        membershipType: membershipResult.rows[0]?.membership_type,
        membershipCount: Number(membershipResult.rows[0]?.count ?? 0),
        teamRoles: new Map(teamMemberResult.rows.map((row) => [row.team_id, row.role]))
      }
    })

    expect(acceptedState.orgRole).toBe('admin')
    expect(acceptedState.membershipType).toBe('team')
    expect(acceptedState.membershipCount).toBe(1)
    expect(acceptedState.teamRoles.get(adminTeam.body.id)).toBe('admin')
    expect(acceptedState.teamRoles.get(memberTeam.body.id)).toBe('member')
  })

  it('rejects invitations for users who are already organization members', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-member-conflict-${uid}@example.com`,
      password: 'strong-pass-12345',
      name: 'Owner Member Conflict'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-member-conflict-${uid}@example.com`,
      password: 'strong-pass-12345',
      name: 'Invitee Member Conflict'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Invite Member Conflict Organization'
    })

    const firstInvite = await request<{ token: string }>(
      '/v1/invitations',
      'create-invitation-member-conflict-first',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(firstInvite.response.status).toBe(201)

    const acceptInvite = await request<{ accepted: boolean }>(
      `/v1/invitations/${firstInvite.body.token}/accept`,
      'accept-invitation-member-conflict-first',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(acceptInvite.response.status).toBe(200)
    expect(acceptInvite.body.accepted).toBe(true)

    const duplicateInvite = await request<{ message: string }>(
      '/v1/invitations',
      'create-invitation-member-conflict-duplicate',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(duplicateInvite.response.status).toBe(409)
    expect(duplicateInvite.body.message).toContain('already an organization member')
  })

  it('accepts invitations idempotently and grants organization access once', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-idempotent-${uid}@example.com`,
      password: 'owner-pass-12345',
      name: 'Owner Idempotent'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-idempotent-${uid}@example.com`,
      password: 'invitee-pass-12345',
      name: 'Invitee Idempotent'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Idempotent Invitation Organization'
    })

    const createdInvitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-idempotent-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    const firstAccept = await request<{ accepted: boolean }>(
      `/v1/invitations/${createdInvitation.body.token}/accept`,
      'accept-idempotent-invitation-first',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(firstAccept.response.status).toBe(200)
    expect(firstAccept.body.accepted).toBe(true)

    const readMembershipCount = async (): Promise<number> => {
      const membershipResult = await dbAuthContext.testContext.withSchemaClient(async (client) =>
        client.query<{ membership_count: string | number }>(
          `
            SELECT COUNT(*)::int AS membership_count
            FROM org_members
            WHERE organization_id = $1
              AND user_id = $2
          `,
          [organization.id, invitee.user.id]
        )
      )

      const rawCount = membershipResult.rows[0]?.membership_count
      if (typeof rawCount === 'number') {
        return rawCount
      }

      const parsed = Number.parseInt(rawCount ?? '0', 10)
      if (Number.isNaN(parsed)) {
        throw new Error('Invalid membership count value returned from org_members query')
      }

      return parsed
    }

    const membershipCountAfterFirstAccept = await readMembershipCount()
    expect(membershipCountAfterFirstAccept).toBe(1)

    const secondAccept = await request<{ message: string }>(
      `/v1/invitations/${createdInvitation.body.token}/accept`,
      'accept-idempotent-invitation-second',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(secondAccept.response.status).toBe(404)

    const membershipCountAfterSecondAccept = await readMembershipCount()
    expect(membershipCountAfterSecondAccept).toBe(1)

    const inviteeOrganizations = await request<{ data: Array<{ id: string }> }>(
      '/v1/organizations',
      'list-organizations-after-accept',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(inviteeOrganizations.response.status).toBe(200)
    expect(inviteeOrganizations.body.data.some((item) => item.id === organization.id)).toBe(true)
  })

  it('rejects acceptance for expired invitation tokens [INV-TEN-009]', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `owner-expired-invite-${uid}@example.com`,
      password: 'owner-pass-12345',
      name: 'Owner Expired Invite'
    })

    const invitee = await createUser(factoryContext, {
      email: `invitee-expired-invite-${uid}@example.com`,
      password: 'invitee-pass-12345',
      name: 'Invitee Expired Invite'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Expired Invitation Organization'
    })

    const createdInvitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-expired-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE invitations
          SET expires_at = now() - interval '1 minute'
          WHERE token = $1
        `,
        [createdInvitation.body.token]
      )
    })

    const acceptExpiredInvitation = await request<{ message: string }>(
      `/v1/invitations/${createdInvitation.body.token}/accept`,
      'accept-expired-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${invitee.token}`
        }
      }
    )

    expect(acceptExpiredInvitation.response.status).toBe(404)

    const invitationStatus = await factoryContext.testContext.withSchemaClient(async (client) =>
      client.query<{ status: string }>(
        `
          SELECT status
          FROM invitations
          WHERE token = $1
          LIMIT 1
        `,
        [createdInvitation.body.token]
      )
    )

    expect(invitationStatus.rows[0]?.status).toBe('pending')
  })

  it('handles concurrent invitation acceptance without duplicate memberships', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `concurrent-accept-owner-${uid}@example.com`,
      password: 'concurrent-pass-12345',
      name: 'Concurrent Accept Owner'
    })

    const invitee = await createUser(factoryContext, {
      email: `concurrent-accept-invitee-${uid}@example.com`,
      password: 'concurrent-pass-12345',
      name: 'Concurrent Accept Invitee'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Concurrent Accept Organization'
    })

    const createdInvitation = await request<{ token: string }>(
      '/v1/invitations',
      'create-concurrent-accept-invitation',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          email: invitee.user.email,
          role: 'member'
        })
      }
    )

    expect(createdInvitation.response.status).toBe(201)

    const [resultA, resultB] = await Promise.all([
      request<{ accepted: boolean }>(
        `/v1/invitations/${createdInvitation.body.token}/accept`,
        'concurrent-accept-a',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${invitee.token}`
          }
        }
      ),
      request<{ accepted: boolean }>(
        `/v1/invitations/${createdInvitation.body.token}/accept`,
        'concurrent-accept-b',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${invitee.token}`
          }
        }
      )
    ])

    const statuses = [resultA.response.status, resultB.response.status].sort()
    expect(statuses).toEqual([200, 404])

    const membershipResult = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      client.query<{ membership_count: string | number }>(
        `
          SELECT COUNT(*)::int AS membership_count
          FROM org_members
          WHERE organization_id = $1
            AND user_id = $2
        `,
        [organization.id, invitee.user.id]
      )
    )

    const rawCount = membershipResult.rows[0]?.membership_count
    const memberCount = typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    expect(memberCount).toBe(1)
  })

  it('rejects organization mutation by an owner of a different organization', async () => {
    const factoryContext = getFactoryContext()

    const ownerA = await createUser(factoryContext, {
      email: `cross-org-mutation-owner-a-${uid}@example.com`,
      password: 'cross-org-mutation-12345',
      name: 'Cross Org Mutation Owner A'
    })

    const ownerB = await createUser(factoryContext, {
      email: `cross-org-mutation-owner-b-${uid}@example.com`,
      password: 'cross-org-mutation-12345',
      name: 'Cross Org Mutation Owner B'
    })

    const orgA = await createOrganization(factoryContext, {
      token: ownerA.token,
      name: 'Cross Org Mutation Target'
    })

    await createOrganization(factoryContext, {
      token: ownerB.token,
      name: 'Cross Org Mutation Attacker Org'
    })

    const crossOrgUpdate = await request<{ message: string }>(
      `/v1/organizations/${orgA.id}`,
      'cross-org-mutation-update-forbidden',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${ownerB.token}`
        },
        body: JSON.stringify({
          name: 'Hijacked Organization'
        })
      }
    )

    expect(crossOrgUpdate.response.status).toBe(401)

    const crossOrgDelete = await request<{ message: string }>(
      `/v1/organizations/${orgA.id}`,
      'cross-org-mutation-delete-forbidden',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${ownerB.token}`
        }
      }
    )

    expect(crossOrgDelete.response.status).toBe(401)

    const orgStillExists = await request<{ id: string; name: string }>(
      `/v1/organizations/${orgA.id}`,
      'cross-org-mutation-verify-unchanged',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ownerA.token}`
        }
      }
    )

    expect(orgStillExists.response.status).toBe(200)
    expect(orgStillExists.body.name).toBe('Cross Org Mutation Target')
  })

  it('updates and clears organization onboarding data', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `onboarding-data-owner-${uid}@example.com`,
      password: 'onboarding-data-pass-12345',
      name: 'Onboarding Data Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Onboarding Data Team'
    })

    const onboardingPayload = {
      version: 1,
      status: 'in_progress',
      currentStep: 'organization_profile',
      completedSteps: []
    }

    const setOnboarding = await request<{ id: string; onboardingData: Record<string, unknown> | null }>(
      `/v1/organizations/${organization.id}`,
      'set-onboarding-data',
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({
          onboardingData: onboardingPayload
        })
      }
    )

    expect(setOnboarding.response.status).toBe(200)
    expect(setOnboarding.body.onboardingData).toEqual(onboardingPayload)

    const fetched = await request<{ onboardingData: Record<string, unknown> | null }>(
      `/v1/organizations/${organization.id}`,
      'get-onboarding-data',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${owner.token}` }
      }
    )

    expect(fetched.response.status).toBe(200)
    expect(fetched.body.onboardingData).toEqual(onboardingPayload)

    const clearOnboarding = await request<{ id: string; onboardingData: Record<string, unknown> | null }>(
      `/v1/organizations/${organization.id}`,
      'clear-onboarding-data',
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({
          onboardingData: null
        })
      }
    )

    expect(clearOnboarding.response.status).toBe(200)
    expect(clearOnboarding.body.onboardingData).toBeNull()
  })
})
