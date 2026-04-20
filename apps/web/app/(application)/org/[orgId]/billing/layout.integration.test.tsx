/**
 * Integration test for the billing route boundary.
 *
 * Billing child pages render the DashboardShell themselves, so this
 * layout must not add another page header or sub-navigation around that
 * shell. Rendering extra chrome here nests the app sidebar inside the
 * billing content area.
 *
 * @spec billing-and-pricing-design §"UI Surfaces"
 */
import { describe, expect, it } from 'vitest'
import BillingLayout from '@/app/(application)/org/[orgId]/billing/layout'
import { renderWithProviders, screen } from '@/integration/test-utils'

describe('BillingLayout route boundary [spec: billing-and-pricing-design §"UI Surfaces"]', () => {
  it('passes children through without adding duplicate billing chrome', () => {
    renderWithProviders(
      <BillingLayout>
        <div data-testid="billing-layout-child">Billing child shell</div>
      </BillingLayout>
    )

    expect(screen.getByTestId('billing-layout-child')).toHaveTextContent('Billing child shell')
    expect(screen.queryByRole('heading', { level: 1, name: 'Billing' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /billing sections/i })).not.toBeInTheDocument()
  })
})
