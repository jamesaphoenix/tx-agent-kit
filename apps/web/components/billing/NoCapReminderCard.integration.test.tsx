import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { beforeEach, describe, expect, it } from 'vitest'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'
import { NoCapReminderCard } from './NoCapReminderCard'

describe('NoCapReminderCard integration', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear()
  })

  it('renders for org admins when no spend cap is set and stays dismissed after dismissal', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-no-cap-${randomUUID()}@example.com`,
      password: 'billing-no-cap-pass-12345',
      name: 'Billing No Cap Owner'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing No Cap Org'
    })

    writeAuthToken(owner.token)

    const user = userEvent.setup()
    const rendered = renderWithProviders(<NoCapReminderCard organizationId={organization.id} />)

    expect(await screen.findByText(/no spend cap set/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    await waitFor(() => {
      expect(screen.queryByText(/no spend cap set/i)).not.toBeInTheDocument()
    })

    globalThis.localStorage?.clear()

    rendered.unmount()
    renderWithProviders(<NoCapReminderCard organizationId={organization.id} />)

    await expect(
      screen.findByText(/no spend cap set/i, {}, { timeout: 750 })
    ).rejects.toThrow()
  })

  it('stores dismissal per user, not globally for the whole organization', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-no-cap-owner-${randomUUID()}@example.com`,
      password: 'billing-no-cap-owner-pass-12345',
      name: 'Billing No Cap Owner'
    })

    const teammate = await createUser(factoryContext, {
      email: `billing-no-cap-teammate-${randomUUID()}@example.com`,
      password: 'billing-no-cap-teammate-pass-12345',
      name: 'Billing No Cap Teammate'
    })

    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing No Cap Per User Org'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO org_members (organization_id, user_id, role)
          VALUES ($1, $2, 'admin')
          ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
        `,
        [organization.id, teammate.user.id]
      )
    })

    const user = userEvent.setup()

    writeAuthToken(owner.token)
    const ownerView = renderWithProviders(<NoCapReminderCard organizationId={organization.id} />)
    expect(await screen.findByText(/no spend cap set/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    await waitFor(() => {
      expect(screen.queryByText(/no spend cap set/i)).not.toBeInTheDocument()
    })

    ownerView.unmount()
    globalThis.localStorage?.clear()

    writeAuthToken(teammate.token)
    renderWithProviders(<NoCapReminderCard organizationId={organization.id} />)

    expect(await screen.findByText(/no spend cap set/i)).toBeInTheDocument()
  })
})
