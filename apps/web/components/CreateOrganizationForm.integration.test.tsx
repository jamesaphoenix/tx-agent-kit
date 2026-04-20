import React from 'react'
import { clearAuthToken, writeAuthToken } from '@/lib/auth-token'
import { clientApi } from '@/lib/client-api'
import { createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it, vi } from 'vitest'
import { CreateOrganizationForm } from './CreateOrganizationForm'
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor
} from '../integration/test-utils'
import { createWebFactoryContext } from '../integration/support/web-integration-context'

describe('CreateOrganizationForm integration', () => {
  it('creates an organization through the web form', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Organization Owner'
    })

    writeAuthToken(owner.token)

    const onCreated = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(<CreateOrganizationForm onCreated={onCreated} />)

    await user.type(screen.getByPlaceholderText('Growth Experiments'), 'Integration Organization')
    await user.click(screen.getByRole('button', { name: 'Create organization' }))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1)
    })

    const organizations = await clientApi.listOrganizations()
    expect(organizations.data.some((organization) => organization.name === 'Integration Organization')).toBe(true)
  })

  it('shows an error and does not create organization when auth token is missing', async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, {
      name: 'Organization Missing Token Owner'
    })

    clearAuthToken()

    const onCreated = vi.fn<() => void | Promise<void>>()
    const user = userEvent.setup()

    renderWithProviders(<CreateOrganizationForm onCreated={onCreated} />)

    const nameInput = screen.getByPlaceholderText('Growth Experiments')
    fireEvent.change(nameInput, {
      target: { value: 'Organization Should Fail' }
    })
    expect(nameInput).toHaveValue('Organization Should Fail')

    await user.click(screen.getByRole('button', { name: 'Create organization' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          /failed to create organization|unauthorized|authentication|missing authorization/i
        )
      ).toBeInTheDocument()
    })

    expect(onCreated).not.toHaveBeenCalled()

    writeAuthToken(owner.token)
    const organizations = await clientApi.listOrganizations()
    expect(organizations.data).toHaveLength(0)
  })

})
