/**
 * Rendering + dispatch tests for the Slice 5 billing email templates.
 *
 * Each test renders a template through the typed helper in
 * `@tx-agent-kit/email` and asserts that the rendered HTML contains the
 * key dynamic fields (so template bugs surface before they hit a real
 * inbox) plus the shared layout chrome (so a broken `EmailLayout` import
 * would fail loudly here rather than inside a Temporal activity).
 *
 * These are deliberately template-rendering tests — the `BillingEmailPortLive`
 * adapter goes through Resend in production, which we do not exercise
 * here. Wiring the port into the worker handler lands in Slice 6.
 *
 * @spec billing-and-pricing-design §"Notifications Integration"
 * @spec notifications-design §"Minimal-First Implementation Plan"
 */
import {
  renderCreditsLowBalanceEmail,
  renderCreditsPurchasedEmail,
  renderCreditsRechargedEmail,
  renderCreditsRefundedEmail,
  renderDisputeCreatedEmail,
  renderPaymentFailedEmail,
  renderRechargeRequiresActionEmail,
  renderSubscriptionCancelledEmail,
  renderUsageCapExceededEmail,
  renderUsageCapWarningEmail,
  renderWelcomeCreditGrantedEmail,
  creditsLowBalanceEmailSubject,
  creditsPurchasedEmailSubject,
  creditsRechargedEmailSubject,
  creditsRefundedEmailSubject,
  disputeCreatedEmailSubject,
  paymentFailedEmailSubject,
  rechargeRequiresActionEmailSubject,
  subscriptionCancelledEmailSubject,
  usageCapExceededEmailSubject,
  usageCapWarningEmailSubject,
  welcomeCreditGrantedEmailSubject
} from '@tx-agent-kit/email'
import { describe, expect, it } from 'vitest'

const FOOTER_ADDRESS = '68 Kings Ride'

describe('billing email templates rendering', () => {
  it('renders WelcomeCreditGranted with the amount, plan, and dashboard link', async () => {
    const html = await renderWelcomeCreditGrantedEmail({
      recipientName: 'Alex',
      amountUsd: '$20',
      planDisplayName: 'Pro',
      dashboardUrl: 'https://tx-agent-kit.local/org/42/billing'
    })
    expect(html).toContain('Alex')
    expect(html).toContain('$20')
    expect(html).toContain('Pro')
    expect(html).toContain('https://tx-agent-kit.local/org/42/billing')
    expect(html).toContain(FOOTER_ADDRESS)
    expect(welcomeCreditGrantedEmailSubject.toLowerCase()).toContain('welcome credit')
  })

  it('renders CreditsLowBalance with current + threshold + top-up link', async () => {
    const html = await renderCreditsLowBalanceEmail({
      recipientName: 'Sam',
      currentBalanceUsd: '$3.21',
      thresholdUsd: '$10.00',
      topUpUrl: 'https://tx-agent-kit.local/org/42/billing?topup=1'
    })
    expect(html).toContain('Sam')
    expect(html).toContain('$3.21')
    expect(html).toContain('$10.00')
    expect(html).toContain('topup=1')
    expect(creditsLowBalanceEmailSubject.toLowerCase()).toContain('low')
  })

  it('renders CreditsPurchased with receipt-style fields', async () => {
    const html = await renderCreditsPurchasedEmail({
      recipientName: 'Casey',
      amountUsd: '$50',
      newBalanceUsd: '$62.17',
      dashboardUrl: 'https://tx-agent-kit.local/org/42/billing'
    })
    expect(html).toContain('$50')
    expect(html).toContain('$62.17')
    expect(creditsPurchasedEmailSubject.toLowerCase()).toContain('top-up')
  })

  it('renders CreditsRecharged with auto-recharge copy', async () => {
    const html = await renderCreditsRechargedEmail({
      recipientName: 'Drew',
      amountUsd: '$25',
      newBalanceUsd: '$28.40',
      dashboardUrl: 'https://tx-agent-kit.local/org/42/billing'
    })
    expect(html).toContain('$25')
    expect(html).toContain('$28.40')
    expect(html.toLowerCase()).toContain('auto-recharge')
    expect(creditsRechargedEmailSubject.toLowerCase()).toContain('auto-recharge')
  })

  it('renders CreditsRefunded with refund receipt copy', async () => {
    const html = await renderCreditsRefundedEmail({
      recipientName: 'Avery',
      amountUsd: '$5.00',
      dashboardUrl: 'https://tx-agent-kit.local/org/42/billing/history'
    })
    expect(html).toContain('Avery')
    expect(html).toContain('$5.00')
    expect(html).toContain('/billing/history')
    expect(creditsRefundedEmailSubject.toLowerCase()).toContain('refund')
  })

  it('renders RechargeRequiresAction pointing at the bank challenge', async () => {
    const html = await renderRechargeRequiresActionEmail({
      recipientName: 'Pat',
      amountUsd: '$25',
      challengeUrl: 'https://hooks.stripe.com/3d_secure/123'
    })
    expect(html).toContain('Pat')
    expect(html).toContain('https://hooks.stripe.com/3d_secure/123')
    expect(html.toLowerCase()).toContain('verification')
    // INV: the client_secret must never appear in the rendered body.
    expect(html.toLowerCase()).not.toContain('client_secret')
    expect(rechargeRequiresActionEmailSubject.toLowerCase()).toContain('confirm')
  })

  it('renders PaymentFailed with grace-period deadline + update link', async () => {
    const html = await renderPaymentFailedEmail({
      recipientName: 'Jordan',
      gracePeriodEndsAtDisplay: 'Monday, 21 April 2026',
      updatePaymentUrl: 'https://tx-agent-kit.local/org/42/billing/settings'
    })
    expect(html).toContain('Monday, 21 April 2026')
    expect(html).toContain('/billing/settings')
    expect(paymentFailedEmailSubject.toLowerCase()).toContain('failed')
  })

  it('renders UsageCapWarning at 80% and 95% variants', async () => {
    const html80 = await renderUsageCapWarningEmail({
      recipientName: 'Riley',
      percentUsed: 80,
      capUsd: '$250',
      dashboardUrl: 'https://tx-agent-kit.local/org/42/billing/usage'
    })
    expect(html80).toContain('80%')
    expect(html80).toContain('$250')
    expect(html80).toContain('/billing/usage')

    const html95 = await renderUsageCapWarningEmail({
      recipientName: 'Riley',
      percentUsed: 95,
      capUsd: '$250',
      dashboardUrl: 'https://tx-agent-kit.local/org/42/billing/usage'
    })
    expect(html95).toContain('95%')
    expect(usageCapWarningEmailSubject.toLowerCase()).toContain('cap')
  })

  it('renders UsageCapExceeded with raise-or-wait copy', async () => {
    const html = await renderUsageCapExceededEmail({
      recipientName: 'Quinn',
      capUsd: '$500',
      dashboardUrl: 'https://tx-agent-kit.local/org/42/billing/settings'
    })
    expect(html).toContain('$500')
    expect(html.toLowerCase()).toContain('cap')
    expect(usageCapExceededEmailSubject.toLowerCase()).toContain('cap')
  })

  it('renders DisputeCreated referencing the charge amount and support link', async () => {
    const html = await renderDisputeCreatedEmail({
      recipientName: 'Morgan',
      chargeAmountUsd: '$199',
      supportUrl: 'mailto:support@tx-agent-kit.local'
    })
    expect(html).toContain('$199')
    expect(html).toContain('support@tx-agent-kit.local')
    expect(disputeCreatedEmailSubject.toLowerCase()).toContain('dispute')
  })

  it('renders SubscriptionCancelled with credit-never-expires language', async () => {
    const html = await renderSubscriptionCancelledEmail({
      recipientName: 'Taylor',
      dashboardUrl: 'https://tx-agent-kit.local/org/42'
    })
    expect(html).toContain('Taylor')
    expect(html.toLowerCase()).toContain('never expire')
    expect(subscriptionCancelledEmailSubject.toLowerCase()).toContain('cancelled')
  })

  it('every template includes the shared tx-agent-kit footer address', async () => {
    const renders = await Promise.all([
      renderWelcomeCreditGrantedEmail({
        recipientName: 'Footer Check',
        amountUsd: '$9',
        planDisplayName: 'Try Me',
        dashboardUrl: 'https://tx-agent-kit.local/'
      }),
      renderCreditsLowBalanceEmail({
        recipientName: 'Footer Check',
        currentBalanceUsd: '$1',
        thresholdUsd: '$5',
        topUpUrl: 'https://tx-agent-kit.local/'
      }),
      renderCreditsPurchasedEmail({
        recipientName: 'Footer Check',
        amountUsd: '$10',
        newBalanceUsd: '$11',
        dashboardUrl: 'https://tx-agent-kit.local/'
      }),
      renderCreditsRechargedEmail({
        recipientName: 'Footer Check',
        amountUsd: '$10',
        newBalanceUsd: '$11',
        dashboardUrl: 'https://tx-agent-kit.local/'
      }),
      renderCreditsRefundedEmail({
        recipientName: 'Footer Check',
        amountUsd: '$5',
        dashboardUrl: 'https://tx-agent-kit.local/'
      }),
      renderRechargeRequiresActionEmail({
        recipientName: 'Footer Check',
        amountUsd: '$10',
        challengeUrl: 'https://hooks.stripe.com/3d_secure/1'
      }),
      renderPaymentFailedEmail({
        recipientName: 'Footer Check',
        gracePeriodEndsAtDisplay: 'tomorrow',
        updatePaymentUrl: 'https://tx-agent-kit.local/'
      }),
      renderUsageCapWarningEmail({
        recipientName: 'Footer Check',
        percentUsed: 80,
        capUsd: '$100',
        dashboardUrl: 'https://tx-agent-kit.local/'
      }),
      renderUsageCapExceededEmail({
        recipientName: 'Footer Check',
        capUsd: '$100',
        dashboardUrl: 'https://tx-agent-kit.local/'
      }),
      renderDisputeCreatedEmail({
        recipientName: 'Footer Check',
        chargeAmountUsd: '$100',
        supportUrl: 'mailto:support@tx-agent-kit.local'
      }),
      renderSubscriptionCancelledEmail({
        recipientName: 'Footer Check',
        dashboardUrl: 'https://tx-agent-kit.local/'
      })
    ])
    for (const html of renders) {
      expect(html).toContain(FOOTER_ADDRESS)
    }
  })
})
