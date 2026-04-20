/**
 * Worker-side Live adapter for `BillingEmailPort`. Mirrors the apps/api
 * adapter but uses the packages/infra/email `EmailDeliveryPort` instead
 * of a direct Resend HTTP call so the worker can inherit any transport
 * upgrades we make in the email package (retries, suppression list,
 * webhook correlation).
 *
 * Each method renders a React Email template via the typed helper in
 * `@tx-agent-kit/email`, then hands the HTML to `EmailDeliveryPort.send`.
 *
 * Used by `billing-notification-handler.ts` to dispatch the email channel
 * alongside the in-app notification write. Failures surface via the
 * returned Effect; the handler catches them to satisfy INV-NOTIF-005.
 *
 * @spec billing-and-pricing-design §"Notifications Integration"
 * @spec notifications-design §"Minimal-First Implementation Plan"
 */
import { BillingEmailPort } from '@tx-agent-kit/core'
import {
  creditsLowBalanceEmailSubject,
  creditsPurchasedEmailSubject,
  creditsRechargedEmailSubject,
  creditsRefundedEmailSubject,
  disputeCreatedEmailSubject,
  EmailDeliveryPort,
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
import { Effect, Layer } from 'effect'

/**
 * Build a `BillingEmailPort` Live layer on top of an `EmailDeliveryPort`.
 * The outer `Layer.effect` ensures the underlying delivery port is
 * acquired once when the layer is provided, not on every call.
 */
export const BillingEmailPortLive = Layer.effect(
  BillingEmailPort,
  Effect.gen(function* () {
    const delivery = yield* EmailDeliveryPort

    return BillingEmailPort.of({
      sendWelcomeCreditGranted: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderWelcomeCreditGrantedEmail({
                recipientName: input.recipientName,
                amountUsd: input.amountUsd,
                planDisplayName: input.planDisplayName,
                dashboardUrl: input.dashboardUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: welcomeCreditGrantedEmailSubject,
            htmlBody: html,
            textBody: welcomeCreditGrantedEmailSubject
          })
        }),

      sendCreditsLowBalance: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderCreditsLowBalanceEmail({
                recipientName: input.recipientName,
                currentBalanceUsd: input.currentBalanceUsd,
                thresholdUsd: input.thresholdUsd,
                topUpUrl: input.topUpUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: creditsLowBalanceEmailSubject,
            htmlBody: html,
            textBody: creditsLowBalanceEmailSubject
          })
        }),

      sendCreditsPurchased: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderCreditsPurchasedEmail({
                recipientName: input.recipientName,
                amountUsd: input.amountUsd,
                newBalanceUsd: input.newBalanceUsd,
                dashboardUrl: input.dashboardUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: creditsPurchasedEmailSubject,
            htmlBody: html,
            textBody: creditsPurchasedEmailSubject
          })
        }),

      sendCreditsRecharged: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderCreditsRechargedEmail({
                recipientName: input.recipientName,
                amountUsd: input.amountUsd,
                newBalanceUsd: input.newBalanceUsd,
                dashboardUrl: input.dashboardUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: creditsRechargedEmailSubject,
            htmlBody: html,
            textBody: creditsRechargedEmailSubject
          })
        }),

      sendCreditsRefunded: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderCreditsRefundedEmail({
                recipientName: input.recipientName,
                amountUsd: input.amountUsd,
                dashboardUrl: input.dashboardUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: creditsRefundedEmailSubject,
            htmlBody: html,
            textBody: creditsRefundedEmailSubject
          })
        }),

      sendRechargeRequiresAction: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderRechargeRequiresActionEmail({
                recipientName: input.recipientName,
                amountUsd: input.amountUsd,
                challengeUrl: input.challengeUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: rechargeRequiresActionEmailSubject,
            htmlBody: html,
            textBody: rechargeRequiresActionEmailSubject
          })
        }),

      sendPaymentFailed: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderPaymentFailedEmail({
                recipientName: input.recipientName,
                gracePeriodEndsAtDisplay: input.gracePeriodEndsAtDisplay,
                updatePaymentUrl: input.updatePaymentUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: paymentFailedEmailSubject,
            htmlBody: html,
            textBody: paymentFailedEmailSubject
          })
        }),

      sendUsageCapWarning: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderUsageCapWarningEmail({
                recipientName: input.recipientName,
                percentUsed: input.percentUsed,
                capUsd: input.capUsd,
                dashboardUrl: input.dashboardUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: usageCapWarningEmailSubject,
            htmlBody: html,
            textBody: usageCapWarningEmailSubject
          })
        }),

      sendUsageCapExceeded: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderUsageCapExceededEmail({
                recipientName: input.recipientName,
                capUsd: input.capUsd,
                dashboardUrl: input.dashboardUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: usageCapExceededEmailSubject,
            htmlBody: html,
            textBody: usageCapExceededEmailSubject
          })
        }),

      sendDisputeCreated: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderDisputeCreatedEmail({
                recipientName: input.recipientName,
                chargeAmountUsd: input.chargeAmountUsd,
                supportUrl: input.supportUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: disputeCreatedEmailSubject,
            htmlBody: html,
            textBody: disputeCreatedEmailSubject
          })
        }),

      sendSubscriptionCancelled: (input) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: async () =>
              renderSubscriptionCancelledEmail({
                recipientName: input.recipientName,
                dashboardUrl: input.dashboardUrl
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
          })
          yield* delivery.send({
            to: input.recipientEmail,
            subject: subscriptionCancelledEmailSubject,
            htmlBody: html,
            textBody: subscriptionCancelledEmailSubject
          })
        })
    })
  })
)
