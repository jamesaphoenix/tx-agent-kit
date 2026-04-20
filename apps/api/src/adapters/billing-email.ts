import {
  creditsLowBalanceEmailSubject,
  creditsPurchasedEmailSubject,
  creditsRechargedEmailSubject,
  creditsRefundedEmailSubject,
  disputeCreatedEmailSubject,
  paymentFailedEmailSubject,
  rechargeRequiresActionEmailSubject,
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
  subscriptionCancelledEmailSubject,
  usageCapExceededEmailSubject,
  usageCapWarningEmailSubject,
  welcomeCreditGrantedEmailSubject
} from '@tx-agent-kit/email'
import { BillingEmailPort } from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect, Layer } from 'effect'
import { getApiEnv } from '../config/env.js'

const logger = createLogger('tx-agent-kit-api').child('billing-email')
const resendEndpoint = 'https://api.resend.com/emails'

interface SendBillingEmailInput {
  apiKey: string
  from: string
  to: string
  subject: string
  html: string
}

/**
 * Plain-text fallback for Resend. Billing templates are short, so a
 * tag-stripping pass produces a perfectly serviceable plain-text
 * version without bespoke per-template copy.
 */
const stripHtmlToText = (html: string): string =>
  html
    .replaceAll(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replaceAll(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replaceAll(/<\/(p|div|h[1-6]|li|section)>/gi, '\n\n')
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll(/\n{3,}/g, '\n\n')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .trim()

const sendResendEmail = (input: SendBillingEmailInput): Effect.Effect<void, unknown> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(resendEndpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from: input.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: stripHtmlToText(input.html)
        })
      })
      if (!response.ok) {
        const payload = await response.text()
        throw new Error(`Resend request failed (${response.status}): ${payload}`)
      }
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error)))
  })

/**
 * Shared dispatch wrapper. Reads env, short-circuits if Resend is not
 * configured (matches the existing `invitation-email.ts` and
 * `password-reset-email.ts` local-dev behaviour), renders the template,
 * and posts to Resend.
 */
const dispatch = (
  recipientEmail: string,
  subject: string,
  render: () => Promise<string>,
  logContext: Record<string, unknown>
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const env = getApiEnv()
    const apiKey = env.RESEND_API_KEY
    const from = env.RESEND_FROM_EMAIL

    if (!apiKey || !from) {
      logger.warn('Billing email skipped because Resend is not configured.', {
        recipientEmail,
        subject,
        ...logContext
      })
      return
    }

    // Render + send are both wrapped in a single Effect.either + ignore
    // so the `BillingEmailPort` interface promise — that the adapter
    // seam never propagates a transport / template error to the
    // caller — actually holds. The previous version used `Effect.tapError`
    // which logs but DOES NOT swallow, leaving the failure to bubble
    // up through the call chain. A transient Resend 429/502 would then
    // fail the worker activity (or trip the welcome-credit grant) even
    // though INV-NOTIF-005 says email delivery is best-effort.
    yield* Effect.gen(function* () {
      const html = yield* Effect.tryPromise({
        try: render,
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
      yield* sendResendEmail({ apiKey, from, to: recipientEmail, subject, html })
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          logger.error(
            'Failed to send billing email.',
            { recipientEmail, subject, ...logContext },
            error instanceof Error ? error : new Error(String(error))
          )
        })
      ),
      Effect.ignore
    )
  })

export const BillingEmailPortLive = Layer.succeed(BillingEmailPort, {
  sendWelcomeCreditGranted: (input) =>
    dispatch(
      input.recipientEmail,
      welcomeCreditGrantedEmailSubject,
      () =>
        renderWelcomeCreditGrantedEmail({
          recipientName: input.recipientName,
          amountUsd: input.amountUsd,
          planDisplayName: input.planDisplayName,
          dashboardUrl: input.dashboardUrl
        }),
      { template: 'welcome-credit-granted' }
    ),

  sendCreditsLowBalance: (input) =>
    dispatch(
      input.recipientEmail,
      creditsLowBalanceEmailSubject,
      () =>
        renderCreditsLowBalanceEmail({
          recipientName: input.recipientName,
          currentBalanceUsd: input.currentBalanceUsd,
          thresholdUsd: input.thresholdUsd,
          topUpUrl: input.topUpUrl
        }),
      { template: 'credits-low-balance' }
    ),

  sendCreditsPurchased: (input) =>
    dispatch(
      input.recipientEmail,
      creditsPurchasedEmailSubject,
      () =>
        renderCreditsPurchasedEmail({
          recipientName: input.recipientName,
          amountUsd: input.amountUsd,
          newBalanceUsd: input.newBalanceUsd,
          dashboardUrl: input.dashboardUrl
        }),
      { template: 'credits-purchased' }
    ),

  sendCreditsRecharged: (input) =>
    dispatch(
      input.recipientEmail,
      creditsRechargedEmailSubject,
      () =>
        renderCreditsRechargedEmail({
          recipientName: input.recipientName,
          amountUsd: input.amountUsd,
          newBalanceUsd: input.newBalanceUsd,
          dashboardUrl: input.dashboardUrl
        }),
      { template: 'credits-recharged' }
    ),

  sendCreditsRefunded: (input) =>
    dispatch(
      input.recipientEmail,
      creditsRefundedEmailSubject,
      () =>
        renderCreditsRefundedEmail({
          recipientName: input.recipientName,
          amountUsd: input.amountUsd,
          dashboardUrl: input.dashboardUrl
        }),
      { template: 'credits-refunded' }
    ),

  sendRechargeRequiresAction: (input) =>
    dispatch(
      input.recipientEmail,
      rechargeRequiresActionEmailSubject,
      () =>
        renderRechargeRequiresActionEmail({
          recipientName: input.recipientName,
          amountUsd: input.amountUsd,
          challengeUrl: input.challengeUrl
        }),
      { template: 'recharge-requires-action' }
    ),

  sendPaymentFailed: (input) =>
    dispatch(
      input.recipientEmail,
      paymentFailedEmailSubject,
      () =>
        renderPaymentFailedEmail({
          recipientName: input.recipientName,
          gracePeriodEndsAtDisplay: input.gracePeriodEndsAtDisplay,
          updatePaymentUrl: input.updatePaymentUrl
        }),
      { template: 'payment-failed' }
    ),

  sendUsageCapWarning: (input) =>
    dispatch(
      input.recipientEmail,
      usageCapWarningEmailSubject,
      () =>
        renderUsageCapWarningEmail({
          recipientName: input.recipientName,
          percentUsed: input.percentUsed,
          capUsd: input.capUsd,
          dashboardUrl: input.dashboardUrl
        }),
      { template: 'usage-cap-warning', percentUsed: input.percentUsed }
    ),

  sendUsageCapExceeded: (input) =>
    dispatch(
      input.recipientEmail,
      usageCapExceededEmailSubject,
      () =>
        renderUsageCapExceededEmail({
          recipientName: input.recipientName,
          capUsd: input.capUsd,
          dashboardUrl: input.dashboardUrl
        }),
      { template: 'usage-cap-exceeded' }
    ),

  sendDisputeCreated: (input) =>
    dispatch(
      input.recipientEmail,
      disputeCreatedEmailSubject,
      () =>
        renderDisputeCreatedEmail({
          recipientName: input.recipientName,
          chargeAmountUsd: input.chargeAmountUsd,
          supportUrl: input.supportUrl
        }),
      { template: 'dispute-created' }
    ),

  sendSubscriptionCancelled: (input) =>
    dispatch(
      input.recipientEmail,
      subscriptionCancelledEmailSubject,
      () =>
        renderSubscriptionCancelledEmail({
          recipientName: input.recipientName,
          dashboardUrl: input.dashboardUrl
        }),
      { template: 'subscription-cancelled' }
    )
})
