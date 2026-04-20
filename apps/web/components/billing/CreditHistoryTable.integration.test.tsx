/**
 * Integration test for the Slice 10 credit history table.
 *
 * Seeds three credit_ledger rows (purchase, usage, adjustment) via
 * direct SQL through the shared factory context, mounts the table,
 * and asserts each row renders with the correct label + signed
 * amount + running balance.
 *
 * @spec billing-and-pricing-design §"UI Surfaces" — credit history
 */
import React from 'react'
import { randomUUID } from 'node:crypto'
import { writeAuthToken } from '@/lib/auth-token'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { CreditHistoryTable } from '@/components/billing/CreditHistoryTable'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import {
  resetIntegrationRouterLocation
} from '@/integration/support/next-router-context'
import { renderWithProviders, screen, waitFor } from '@/integration/test-utils'

interface LedgerSeed {
  readonly id: string
  readonly entryType: 'purchase' | 'usage' | 'adjustment'
  readonly amountDecimillicents: number
  readonly reason: string
  readonly balanceAfter: number
  readonly createdAt: Date
}

const seedLedger = async (
  ctx: ReturnType<typeof createWebFactoryContext>,
  organizationId: string,
  rows: ReadonlyArray<LedgerSeed>
): Promise<void> => {
  await ctx.testContext.withSchemaClient(async (client) => {
    for (const row of rows) {
      await client.query(
        `INSERT INTO credit_ledger
            (id, organization_id, amount_decimillicents, entry_type,
             reason, balance_after, metadata, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7)`,
        [
          row.id,
          organizationId,
          row.amountDecimillicents,
          row.entryType,
          row.reason,
          row.balanceAfter,
          row.createdAt.toISOString()
        ]
      )
    }
  })
}

describe('CreditHistoryTable integration [spec: billing-and-pricing-design §"UI Surfaces"]', () => {
  it('renders each seeded ledger entry with label, signed amount, and running balance', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `credit-history-${randomUUID()}@example.com`,
      password: 'credit-history-pass-12345',
      name: 'Credit History Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Credit History Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing/history`)

    const baseTime = Date.now()
    const purchaseId = randomUUID()
    const usageId = randomUUID()
    const adjustmentId = randomUUID()

    await seedLedger(ctx, org.id, [
      {
        id: purchaseId,
        entryType: 'purchase',
        amountDecimillicents: 250_000_000, // $25
        reason: 'top-up via stripe',
        balanceAfter: 250_000_000,
        createdAt: new Date(baseTime - 3000)
      },
      {
        id: usageId,
        entryType: 'usage',
        // Production stores usage with a NEGATIVE amount (see
        // storage-billing-service.ts and credit-service.ts) — the
        // ledger sign carries the direction directly.
        amountDecimillicents: -50_000_000, // -$5
        reason: 'openrouter inference run',
        balanceAfter: 200_000_000,
        createdAt: new Date(baseTime - 2000)
      },
      {
        id: adjustmentId,
        entryType: 'adjustment',
        amountDecimillicents: 90_000_000, // welcome credit $9
        reason: 'welcome_credit',
        balanceAfter: 290_000_000,
        createdAt: new Date(baseTime - 1000)
      }
    ])

    renderWithProviders(<CreditHistoryTable organizationId={org.id} />)

    // Wait for each row to render by its data-testid.
    await waitFor(() => {
      expect(screen.getByTestId(`credit-history-row-${purchaseId}`)).toBeInTheDocument()
    })
    expect(screen.getByTestId(`credit-history-row-${usageId}`)).toBeInTheDocument()
    expect(screen.getByTestId(`credit-history-row-${adjustmentId}`)).toBeInTheDocument()

    const purchaseRow = screen.getByTestId(`credit-history-row-${purchaseId}`)
    expect(purchaseRow).toHaveTextContent('Top-up')
    expect(purchaseRow).toHaveTextContent('top-up via stripe')
    expect(purchaseRow).toHaveTextContent('+$25.00')
    expect(purchaseRow).toHaveTextContent('$25.00')

    const usageRow = screen.getByTestId(`credit-history-row-${usageId}`)
    expect(usageRow).toHaveTextContent('Usage')
    expect(usageRow).toHaveTextContent('openrouter inference run')
    expect(usageRow).toHaveTextContent('-$5.00')
    expect(usageRow).toHaveTextContent('$20.00')

    const adjustmentRow = screen.getByTestId(`credit-history-row-${adjustmentId}`)
    expect(adjustmentRow).toHaveTextContent('Adjustment')
    expect(adjustmentRow).toHaveTextContent('welcome_credit')
    expect(adjustmentRow).toHaveTextContent('+$9.00')
    expect(adjustmentRow).toHaveTextContent('$29.00')
  })

  it('shows an empty-state row when the organization has no ledger entries', async () => {
    const ctx = createWebFactoryContext()
    const owner = await createUser(ctx, {
      email: `credit-history-empty-${randomUUID()}@example.com`,
      password: 'credit-history-empty-pass-12345',
      name: 'Credit History Empty Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Credit History Empty Org'
    })
    writeAuthToken(owner.token)
    resetIntegrationRouterLocation(`/org/${org.id}/billing/history`)

    renderWithProviders(<CreditHistoryTable organizationId={org.id} />)

    await waitFor(() => {
      expect(screen.getByText(/no credit history yet/i)).toBeInTheDocument()
    })
  })
})
