import { randomUUID } from 'node:crypto'
import { createOrganization, createUser, defaultTestBrandSettings, setTeamMemberRole } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import {
  createTestFixture
} from './test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'api_teams'
})

describe('teams integration', () => {
  it('supports team CRUD lifecycle within an organization', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `team-crud-owner-${uid}@example.com`,
      password: 'team-crud-pass-12345',
      name: 'Team CRUD Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Team CRUD Organization'
    })

    const created = await request<{
      id: string
      organizationId: string
      name: string
      website: string | null
      createdAt: string
      updatedAt: string
    }>(
      '/v1/teams',
      'team-crud-create',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Engineering Team',
          website: 'https://example.com',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(created.response.status).toBe(201)
    expect(created.body.name).toBe('Engineering Team')
    expect(created.body.organizationId).toBe(organization.id)
    expect(created.body.website).toBe('https://example.com')
    expect(created.body.createdAt).toBeTruthy()

    const fetched = await request<{
      id: string
      name: string
      organizationId: string
    }>(
      `/v1/teams/${created.body.id}`,
      'team-crud-get',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(fetched.response.status).toBe(200)
    expect(fetched.body.id).toBe(created.body.id)
    expect(fetched.body.name).toBe('Engineering Team')

    const updated = await request<{
      id: string
      name: string
    }>(
      `/v1/teams/${created.body.id}`,
      'team-crud-update',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          name: 'Platform Team'
        })
      }
    )

    expect(updated.response.status).toBe(200)
    expect(updated.body.name).toBe('Platform Team')

    const listed = await request<{
      data: Array<{ id: string; name: string }>
      total: number
    }>(
      `/v1/teams?organizationId=${organization.id}`,
      'team-crud-list',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(listed.response.status).toBe(200)
    expect(listed.body.total).toBe(1)
    expect(listed.body.data[0]?.name).toBe('Platform Team')

    const deleted = await request<{ deleted: boolean }>(
      `/v1/teams/${created.body.id}`,
      'team-crud-delete',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(deleted.response.status).toBe(200)
    expect(deleted.body.deleted).toBe(true)

    const listedAfterDelete = await request<{
      data: Array<{ id: string }>
      total: number
    }>(
      `/v1/teams?organizationId=${organization.id}`,
      'team-crud-list-after-delete',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )

    expect(listedAfterDelete.response.status).toBe(200)
    expect(listedAfterDelete.body.total).toBe(0)
  })

  it('allows an org admin to delete a workspace even when their per-team role is viewer', async () => {
    // Repro for the staging "missing permissions to delete teams" report: an org
    // admin whose per-team role is viewer must still be able to perform an
    // admin-permission team action (org admins manage every team in their org).
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `team-admin-viewer-delete-${uid}@example.com`,
      password: 'team-admin-viewer-pass-12345',
      name: 'Team Admin Viewer'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Team Admin Viewer Organization'
    })

    // Two workspaces so deleting one is not the protected last workspace.
    const firstTeam = await request<{ id: string }>(
      '/v1/teams',
      'team-admin-viewer-create-a',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Viewer Delete A',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    expect(firstTeam.response.status).toBe(201)

    const secondTeam = await request<{ id: string }>(
      '/v1/teams',
      'team-admin-viewer-create-b',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Viewer Delete B',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    expect(secondTeam.response.status).toBe(201)

    // Demote the org admin to a team viewer (viewer's team-role permissions
    // exclude delete_teams), but they remain the org admin.
    await setTeamMemberRole(factoryContext, {
      teamId: firstTeam.body.id,
      userId: owner.user.id,
      role: 'viewer'
    })

    const deleted = await request<{ deleted: boolean }>(
      `/v1/teams/${firstTeam.body.id}`,
      'team-admin-viewer-delete',
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${owner.token}` }
      }
    )

    expect(deleted.response.status).toBe(200)
    expect(deleted.body.deleted).toBe(true)
  })

  it('rejects team operations without auth token', async () => {
    const listWithoutAuth = await request<{ message: string }>(
      '/v1/teams?organizationId=00000000-0000-0000-0000-000000000000',
      'team-unauthorized-list',
      {
        method: 'GET'
      }
    )

    expect(listWithoutAuth.response.status).toBe(401)

    const createWithoutAuth = await request<{ message: string }>(
      '/v1/teams',
      'team-unauthorized-create',
      {
        method: 'POST',
        body: JSON.stringify({
          organizationId: '00000000-0000-0000-0000-000000000000',
          name: 'Unauthorized Team',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(createWithoutAuth.response.status).toBe(401)
  })

  it('isolates team visibility between organizations', async () => {
    const factoryContext = getFactoryContext()

    const ownerA = await createUser(factoryContext, {
      email: `team-isolation-owner-a-${uid}@example.com`,
      password: 'team-isolation-pass-12345',
      name: 'Team Isolation Owner A'
    })

    const ownerB = await createUser(factoryContext, {
      email: `team-isolation-owner-b-${uid}@example.com`,
      password: 'team-isolation-pass-12345',
      name: 'Team Isolation Owner B'
    })

    const orgA = await createOrganization(factoryContext, {
      token: ownerA.token,
      name: 'Team Isolation Org A'
    })

    const orgB = await createOrganization(factoryContext, {
      token: ownerB.token,
      name: 'Team Isolation Org B'
    })

    const teamA = await request<{ id: string; name: string }>(
      '/v1/teams',
      'team-isolation-create-a',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ownerA.token}`
        },
        body: JSON.stringify({
          organizationId: orgA.id,
          name: 'Team Alpha',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(teamA.response.status).toBe(201)

    const teamB = await request<{ id: string; name: string }>(
      '/v1/teams',
      'team-isolation-create-b',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ownerB.token}`
        },
        body: JSON.stringify({
          organizationId: orgB.id,
          name: 'Team Beta',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(teamB.response.status).toBe(201)

    const orgATeams = await request<{
      data: Array<{ id: string; name: string }>
      total: number
    }>(
      `/v1/teams?organizationId=${orgA.id}`,
      'team-isolation-list-a',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ownerA.token}`
        }
      }
    )

    expect(orgATeams.response.status).toBe(200)
    expect(orgATeams.body.total).toBe(1)
    expect(orgATeams.body.data[0]?.name).toBe('Team Alpha')

    const orgBTeams = await request<{
      data: Array<{ id: string; name: string }>
      total: number
    }>(
      `/v1/teams?organizationId=${orgB.id}`,
      'team-isolation-list-b',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ownerB.token}`
        }
      }
    )

    expect(orgBTeams.response.status).toBe(200)
    expect(orgBTeams.body.total).toBe(1)
    expect(orgBTeams.body.data[0]?.name).toBe('Team Beta')
  })

  it('rejects team mutation by a user from a different organization', async () => {
    const factoryContext = getFactoryContext()

    const ownerA = await createUser(factoryContext, {
      email: `cross-org-team-owner-a-${uid}@example.com`,
      password: 'cross-org-pass-12345',
      name: 'Cross Org Team Owner A'
    })

    const ownerB = await createUser(factoryContext, {
      email: `cross-org-team-owner-b-${uid}@example.com`,
      password: 'cross-org-pass-12345',
      name: 'Cross Org Team Owner B'
    })

    const orgA = await createOrganization(factoryContext, {
      token: ownerA.token,
      name: 'Cross Org Team Org A'
    })

    await createOrganization(factoryContext, {
      token: ownerB.token,
      name: 'Cross Org Team Org B'
    })

    const teamA = await request<{ id: string; name: string }>(
      '/v1/teams',
      'cross-org-team-create-a',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ownerA.token}`
        },
        body: JSON.stringify({
          organizationId: orgA.id,
          name: 'Team Owned By Org A',
          brandSettings: defaultTestBrandSettings
        })
      }
    )

    expect(teamA.response.status).toBe(201)

    const crossOrgUpdate = await request<{ message: string }>(
      `/v1/teams/${teamA.body.id}`,
      'cross-org-team-update-forbidden',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${ownerB.token}`
        },
        body: JSON.stringify({
          name: 'Hijacked Team Name'
        })
      }
    )

    expect(crossOrgUpdate.response.status).toBe(403)

    const crossOrgDelete = await request<{ message: string }>(
      `/v1/teams/${teamA.body.id}`,
      'cross-org-team-delete-forbidden',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${ownerB.token}`
        }
      }
    )

    expect(crossOrgDelete.response.status).toBe(403)

    const teamStillExists = await request<{ id: string; name: string }>(
      `/v1/teams/${teamA.body.id}`,
      'cross-org-team-verify-unchanged',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${ownerA.token}`
        }
      }
    )

    expect(teamStillExists.response.status).toBe(200)
    expect(teamStillExists.body.name).toBe('Team Owned By Org A')
  })

  it('keeps org-admin team member management working after the admin leaves one workspace', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `team-self-remove-owner-${uid}@example.com`,
      password: 'team-self-remove-pass-12345',
      name: 'Team Self Remove Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Team Self Remove Organization'
    })

    const firstTeam = await request<{ id: string; name: string }>(
      '/v1/teams',
      'team-self-remove-create-first',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'First Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    expect(firstTeam.response.status).toBe(201)

    const secondTeam = await request<{ id: string; name: string }>(
      '/v1/teams',
      'team-self-remove-create-second',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Second Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    expect(secondTeam.response.status).toBe(201)

    const firstTeamMembers = await request<{
      data: Array<{ id: string; userId: string }>
    }>(
      `/v1/teams/${firstTeam.body.id}/members`,
      'team-self-remove-list-first-before',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )
    expect(firstTeamMembers.response.status).toBe(200)

    const ownerFirstTeamMembership = firstTeamMembers.body.data.find((member) => member.userId === owner.user.id)
    expect(ownerFirstTeamMembership).toBeDefined()

    const removed = await request<{ deleted: true }>(
      `/v1/teams/${firstTeam.body.id}/members/${ownerFirstTeamMembership!.id}`,
      'team-self-remove-delete-first-membership',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )
    expect(removed.response.status).toBe(200)
    expect(removed.body.deleted).toBe(true)

    const firstTeamMembersAfterRemoval = await request<{
      data: Array<{ id: string; userId: string }>
    }>(
      `/v1/teams/${firstTeam.body.id}/members`,
      'team-self-remove-list-first-after',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )
    expect(firstTeamMembersAfterRemoval.response.status).toBe(200)
    expect(firstTeamMembersAfterRemoval.body.data.some((member) => member.userId === owner.user.id)).toBe(false)

    const secondTeamMembers = await request<{
      data: Array<{ id: string; userId: string }>
    }>(
      `/v1/teams/${secondTeam.body.id}/members`,
      'team-self-remove-list-second-after',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )
    expect(secondTeamMembers.response.status).toBe(200)
    expect(secondTeamMembers.body.data.some((member) => member.userId === owner.user.id)).toBe(true)
  })

  it('keeps non-admins signed in by hiding removed workspaces and returning forbidden for removed team access', async () => {
    const factoryContext = getFactoryContext()

    const owner = await createUser(factoryContext, {
      email: `team-member-removal-owner-${uid}@example.com`,
      password: 'team-member-removal-pass-12345',
      name: 'Team Member Removal Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Team Member Removal Organization'
    })

    const member = await createUser(factoryContext, {
      email: `team-member-removal-member-${uid}@example.com`,
      password: 'team-member-removal-pass-12345',
      name: 'Team Member Removal Member'
    })

    const firstTeam = await request<{ id: string; name: string }>(
      '/v1/teams',
      'team-member-removal-create-first',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Member First Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    expect(firstTeam.response.status).toBe(201)

    const secondTeam = await request<{ id: string; name: string }>(
      '/v1/teams',
      'team-member-removal-create-second',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          name: 'Member Second Workspace',
          brandSettings: defaultTestBrandSettings
        })
      }
    )
    expect(secondTeam.response.status).toBe(201)

    const addedOrgMember = await request<{ id: string; userId: string }>(
      `/v1/organizations/${organization.id}/members`,
      'team-member-removal-add-org-member',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`
        },
        body: JSON.stringify({
          userId: member.user.id,
          role: 'member'
        })
      }
    )
    expect(addedOrgMember.response.status).toBe(201)

    const visibleBeforeRemoval = await request<{
      data: Array<{ id: string; name: string }>
      total: number
    }>(
      `/v1/teams?organizationId=${organization.id}&sortBy=name&sortOrder=asc`,
      'team-member-removal-list-before',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )
    expect(visibleBeforeRemoval.response.status).toBe(200)
    expect(visibleBeforeRemoval.body.data.map((team) => team.id).sort()).toEqual(
      [firstTeam.body.id, secondTeam.body.id].sort()
    )

    const firstTeamMembers = await request<{
      data: Array<{ id: string; userId: string }>
    }>(
      `/v1/teams/${firstTeam.body.id}/members`,
      'team-member-removal-list-first-members',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )
    expect(firstTeamMembers.response.status).toBe(200)

    const memberFirstTeamMembership = firstTeamMembers.body.data.find((row) => row.userId === member.user.id)
    expect(memberFirstTeamMembership).toBeDefined()

    const removed = await request<{ deleted: true }>(
      `/v1/teams/${firstTeam.body.id}/members/${memberFirstTeamMembership!.id}`,
      'team-member-removal-remove-first-membership',
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${owner.token}`
        }
      }
    )
    expect(removed.response.status).toBe(200)

    const visibleAfterRemoval = await request<{
      data: Array<{ id: string; name: string }>
      total: number
    }>(
      `/v1/teams?organizationId=${organization.id}&sortBy=name&sortOrder=asc`,
      'team-member-removal-list-after',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )
    expect(visibleAfterRemoval.response.status).toBe(200)
    expect(visibleAfterRemoval.body.data.map((team) => team.id)).toEqual([secondTeam.body.id])

    const removedTeamAccess = await request<{ message: string }>(
      `/v1/teams/${firstTeam.body.id}/members`,
      'team-member-removal-list-removed-team',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )
    expect(removedTeamAccess.response.status).toBe(403)

    const remainingTeamAccess = await request<{ data: Array<{ id: string; userId: string }> }>(
      `/v1/teams/${secondTeam.body.id}/members`,
      'team-member-removal-list-remaining-team',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${member.token}`
        }
      }
    )
    expect(remainingTeamAccess.response.status).toBe(200)
    expect(remainingTeamAccess.body.data.some((row) => row.userId === member.user.id)).toBe(true)
  })
})
