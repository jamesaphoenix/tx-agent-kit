import { render } from '@react-email/components'
import * as React from 'react'
import {
  CreditsLowBalanceEmail,
  type CreditsLowBalanceEmailProps
} from './credits-low-balance.js'
import {
  CreditsPurchasedEmail,
  type CreditsPurchasedEmailProps
} from './credits-purchased.js'
import {
  CreditsRechargedEmail,
  type CreditsRechargedEmailProps
} from './credits-recharged.js'
import {
  CreditsRefundedEmail,
  type CreditsRefundedEmailProps
} from './credits-refunded.js'
import {
  DisputeCreatedEmail,
  type DisputeCreatedEmailProps
} from './dispute-created.js'
import {
  PaymentFailedEmail,
  type PaymentFailedEmailProps
} from './payment-failed.js'
import {
  RechargeRequiresActionEmail,
  type RechargeRequiresActionEmailProps
} from './recharge-requires-action.js'
import {
  SubscriptionCancelledEmail,
  type SubscriptionCancelledEmailProps
} from './subscription-cancelled.js'
import {
  UsageCapExceededEmail,
  type UsageCapExceededEmailProps
} from './usage-cap-exceeded.js'
import {
  UsageCapWarningEmail,
  type UsageCapWarningEmailProps
} from './usage-cap-warning.js'
import {
  WelcomeCreditGrantedEmail,
  type WelcomeCreditGrantedEmailProps
} from './welcome-credit-granted.js'

/**
 * Typed render helpers for the Slice 5 billing templates. Keeping the
 * React + react-email imports inside `packages/infra/email` means that
 * `apps/api/src/adapters/billing-email.ts` only needs a dependency on
 * `@tx-agent-kit/email` — no direct React import from the API app.
 *
 * Each helper returns the rendered HTML string. Callers wrap the call
 * in `Effect.tryPromise` and hand the HTML to the transport (Resend).
 */

export const renderWelcomeCreditGrantedEmail = (
  props: WelcomeCreditGrantedEmailProps
): Promise<string> => render(React.createElement(WelcomeCreditGrantedEmail, props))

export const renderCreditsLowBalanceEmail = (
  props: CreditsLowBalanceEmailProps
): Promise<string> => render(React.createElement(CreditsLowBalanceEmail, props))

export const renderCreditsPurchasedEmail = (
  props: CreditsPurchasedEmailProps
): Promise<string> => render(React.createElement(CreditsPurchasedEmail, props))

export const renderCreditsRechargedEmail = (
  props: CreditsRechargedEmailProps
): Promise<string> => render(React.createElement(CreditsRechargedEmail, props))

export const renderCreditsRefundedEmail = (
  props: CreditsRefundedEmailProps
): Promise<string> => render(React.createElement(CreditsRefundedEmail, props))

export const renderRechargeRequiresActionEmail = (
  props: RechargeRequiresActionEmailProps
): Promise<string> => render(React.createElement(RechargeRequiresActionEmail, props))

export const renderPaymentFailedEmail = (
  props: PaymentFailedEmailProps
): Promise<string> => render(React.createElement(PaymentFailedEmail, props))

export const renderUsageCapWarningEmail = (
  props: UsageCapWarningEmailProps
): Promise<string> => render(React.createElement(UsageCapWarningEmail, props))

export const renderUsageCapExceededEmail = (
  props: UsageCapExceededEmailProps
): Promise<string> => render(React.createElement(UsageCapExceededEmail, props))

export const renderDisputeCreatedEmail = (
  props: DisputeCreatedEmailProps
): Promise<string> => render(React.createElement(DisputeCreatedEmail, props))

export const renderSubscriptionCancelledEmail = (
  props: SubscriptionCancelledEmailProps
): Promise<string> => render(React.createElement(SubscriptionCancelledEmail, props))
