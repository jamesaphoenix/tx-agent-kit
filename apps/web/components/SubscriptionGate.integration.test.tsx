import React, { useEffect, useState } from 'react'
import type { BillingSettings } from '@tx-agent-kit/contracts'
import { writeAuthToken } from '@/lib/auth-token'
import { ApiClientError, clientApi } from '@/lib/client-api'
import { createTeam, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createWebFactoryContext } from '../integration/support/web-integration-context'
import { renderWithProviders, screen, waitFor } from '../integration/test-utils'
import { SubscriptionGate } from './SubscriptionGate'

function SubscriptionGateHarness({ organizationId }: { organizationId: string }) {
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const billingSettings = await clientApi.getBillingSettings(organizationId)
        if (!active) {
          return
        }

        setSettings(billingSettings)
      } catch (error) {
        if (!active) {
          return
        }

        if (error instanceof ApiClientError) {
          setErrorMessage(error.message)
          return
        }

        setErrorMessage('unknown-error')
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [organizationId])

  if (errorMessage) {
    return <span>{errorMessage}</span>
  }

  if (!settings) {
    return <span>subscription-loading</span>
  }

  return (
    <SubscriptionGate
      subscriptionStatus={settings.subscriptionStatus}
      isSubscribed={settings.isSubscribed}
      fallback={<span>subscription-fallback</span>}
    >
      <span>subscription-protected-content</span>
    </SubscriptionGate>
  )
}

describe('SubscriptionGate integration', () => {
  it('renders protected content when billing settings report an active subscription', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'subscription-gate-owner@example.com',
      password: 'subscription-gate-owner-pass-12345',
      name: 'Subscription Gate Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Subscription Gate Active Team'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
          SET is_subscribed = TRUE, subscription_status = 'active'
          WHERE id = $1
        `,
        [organization.id]
      )
    })

    writeAuthToken(owner.token)

    renderWithProviders(<SubscriptionGateHarness organizationId={organization.id} />)

    await waitFor(() => {
      expect(screen.getByText('subscription-protected-content')).toBeInTheDocument()
    })
    expect(screen.queryByText('subscription-fallback')).not.toBeInTheDocument()
  })

  it('renders fallback when billing settings report an inactive subscription', async () => {
    const factoryContext = createWebFactoryContext()

    const owner = await createUser(factoryContext, {
      email: 'subscription-gate-inactive-owner@example.com',
      password: 'subscription-gate-inactive-owner-pass-12345',
      name: 'Subscription Gate Inactive Owner'
    })

    const organization = await createTeam(factoryContext, {
      token: owner.token,
      name: 'Subscription Gate Inactive Team'
    })

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          UPDATE organizations
          SET is_subscribed = FALSE, subscription_status = 'inactive'
          WHERE id = $1
        `,
        [organization.id]
      )
    })

    writeAuthToken(owner.token)

    renderWithProviders(<SubscriptionGateHarness organizationId={organization.id} />)

    await waitFor(() => {
      expect(screen.getByText('subscription-fallback')).toBeInTheDocument()
    })
    expect(screen.queryByText('subscription-protected-content')).not.toBeInTheDocument()
  })
})
