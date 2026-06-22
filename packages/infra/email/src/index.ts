export { getEmailEnv, resetEmailEnvCache, type EmailEnv } from './env.js'
export { getResendClient, resetResendClientCache } from './client.js'
export {
  EmailDeliveryError,
  EmailDeliveryPort,
  EmailDeliveryPortLive,
  type SendInput,
  type SendResult,
  type BatchSendInput
} from './delivery.js'
export {
  WebhookVerificationError,
  verifyResendWebhook,
  parseResendWebhookEvent,
  type ResendWebhookEvent,
  type ResendEmailSentEvent,
  type ResendEmailDeliveredEvent,
  type ResendEmailBouncedEvent,
  type ResendEmailComplainedEvent,
  type ResendEmailOpenedEvent,
  type ResendEmailClickedEvent
} from './webhook.js'
export {
  SuppressionStorePort,
  type SuppressionEntry
} from './suppression.js'
export { EmailLayout, type EmailLayoutProps } from './templates/shared/layout.js'
export { WelcomeEmail, welcomeEmailSubject, type WelcomeEmailProps } from './templates/onboarding/welcome.js'
export {
  FirstCampaignEmail,
  firstCampaignEmailSubject,
  type FirstCampaignEmailProps
} from './templates/onboarding/first-campaign.js'
export {
  PowerUserTipsEmail,
  powerUserTipsEmailSubject,
  type PowerUserTipsEmailProps
} from './templates/onboarding/power-user-tips.js'

// ---- Billing email templates (Slice 5) ----
export {
  WelcomeCreditGrantedEmail,
  welcomeCreditGrantedEmailSubject,
  type WelcomeCreditGrantedEmailProps
} from './templates/billing/welcome-credit-granted.js'
export {
  CreditsLowBalanceEmail,
  creditsLowBalanceEmailSubject,
  type CreditsLowBalanceEmailProps
} from './templates/billing/credits-low-balance.js'
export {
  CreditsPurchasedEmail,
  creditsPurchasedEmailSubject,
  type CreditsPurchasedEmailProps
} from './templates/billing/credits-purchased.js'
export {
  CreditsRechargedEmail,
  creditsRechargedEmailSubject,
  type CreditsRechargedEmailProps
} from './templates/billing/credits-recharged.js'
export {
  CreditsRefundedEmail,
  creditsRefundedEmailSubject,
  type CreditsRefundedEmailProps
} from './templates/billing/credits-refunded.js'
export {
  RechargeRequiresActionEmail,
  rechargeRequiresActionEmailSubject,
  type RechargeRequiresActionEmailProps
} from './templates/billing/recharge-requires-action.js'
export {
  PaymentFailedEmail,
  paymentFailedEmailSubject,
  type PaymentFailedEmailProps
} from './templates/billing/payment-failed.js'
export {
  UsageCapWarningEmail,
  usageCapWarningEmailSubject,
  type UsageCapWarningEmailProps
} from './templates/billing/usage-cap-warning.js'
export {
  UsageCapExceededEmail,
  usageCapExceededEmailSubject,
  type UsageCapExceededEmailProps
} from './templates/billing/usage-cap-exceeded.js'
export {
  DisputeCreatedEmail,
  disputeCreatedEmailSubject,
  type DisputeCreatedEmailProps
} from './templates/billing/dispute-created.js'
export {
  SubscriptionCancelledEmail,
  subscriptionCancelledEmailSubject,
  type SubscriptionCancelledEmailProps
} from './templates/billing/subscription-cancelled.js'
export {
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
  renderWelcomeCreditGrantedEmail
} from './templates/billing/render.js'

// ---- Lifecycle email templates (lifecycle email engine) ----
export type { LifecycleEmailProps } from './templates/lifecycle/props.js'
export {
  renderEmailTemplate,
  templateRenderers
} from './templates/registry.js'
export { LifecycleWelcomeEmail } from './templates/lifecycle/welcome.js'
export { LifecycleCompleteOnboardingEmail } from './templates/lifecycle/complete-onboarding.js'
export { LifecycleCreateWorkspaceEmail } from './templates/lifecycle/create-workspace.js'
export { LifecycleInviteTeammateEmail } from './templates/lifecycle/invite-teammate.js'
export { LifecycleUploadFirstAssetEmail } from './templates/lifecycle/upload-first-asset.js'
export { LifecycleActivationTipsEmail } from './templates/lifecycle/activation-tips.js'
export { LifecycleTrialGettingStartedEmail } from './templates/lifecycle/trial-getting-started.js'
export { LifecycleTrialEndingSoonEmail } from './templates/lifecycle/trial-ending-soon.js'
export { LifecycleFeatureSpotlightCreditsEmail } from './templates/lifecycle/feature-spotlight-credits.js'
export { LifecycleInactiveNudgeEmail } from './templates/lifecycle/inactive-nudge.js'
export { LifecycleInactiveFinalEmail } from './templates/lifecycle/inactive-final.js'
export { LifecycleWeMissYouEmail } from './templates/lifecycle/we-miss-you.js'
export { LifecycleChurnedWinbackEmail } from './templates/lifecycle/churned-winback.js'
export { LifecycleChurnedFeedbackEmail } from './templates/lifecycle/churned-feedback.js'
export { LifecycleUsageMilestoneEmail } from './templates/lifecycle/usage-milestone.js'
export { LifecycleFeedbackRequestEmail } from './templates/lifecycle/feedback-request.js'
