import React from 'react'
import { writeAuthToken } from '@/lib/auth-token'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createWebFactoryContext } from '../integration/support/web-integration-context'
import { renderWithProviders, screen, waitFor } from '../integration/test-utils'
import { PermissionsGate } from './PermissionsGate'

describe('PermissionsGate integration', () => {
  it('renders protected content when API-resolved permissions include the requirement', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'permissions-gate-owner@example.com',
      password: 'permissions-gate-owner-pass-12345',
      name: 'Permissions Gate Owner'
    })

    await createTeam(factoryContext, {
      token: owner.token,
      name: 'Permissions Gate Owner Team'
    })

    writeAuthToken(owner.token)

    renderWithProviders(
      <PermissionsGate
        permission="manage_billing"
        fallback={<span>permissions-fallback</span>}
      >
        <span>permissions-protected-content</span>
      </PermissionsGate>
    )

    await waitFor(() => {
      expect(screen.getByText('permissions-protected-content')).toBeInTheDocument()
    })
    expect(screen.queryByText('permissions-fallback')).not.toBeInTheDocument()
  })

  it('renders fallback when API-resolved permissions do not include the requirement', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'permissions-gate-member-owner@example.com',
      password: 'permissions-gate-member-owner-pass-12345',
      name: 'Permissions Gate Member Owner'
    })

    const member = await createUser(factoryContext, {
      email: 'permissions-gate-member@example.com',
      password: 'permissions-gate-member-pass-12345',
      name: 'Permissions Gate Member'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Permissions Gate Member Team'
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

    writeAuthToken(member.token)

    renderWithProviders(
      <PermissionsGate
        permission="manage_billing"
        fallback={<span>permissions-fallback</span>}
      >
        <span>permissions-protected-content</span>
      </PermissionsGate>
    )

    await waitFor(() => {
      expect(screen.getByText('permissions-fallback')).toBeInTheDocument()
    })
    expect(screen.queryByText('permissions-protected-content')).not.toBeInTheDocument()
  })
})
