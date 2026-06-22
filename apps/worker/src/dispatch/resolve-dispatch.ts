import type { Duration } from '@temporalio/common'
import type { SerializedDomainEvent } from '../activities.js'

/**
 * Pure mapping from an outbox domain event to a Temporal workflow start plan.
 *
 * Extracted verbatim from the former `outboxPollerWorkflow` switch so the
 * worker-owned dispatcher loop (`outbox-dispatcher.ts`) can start workflows via
 * the Temporal Client instead of `startChild`. Keeping this pure makes the full
 * event-type table unit-testable without a workflow sandbox or a running server.
 *
 * Workflow type names are the registered (exported) workflow function names —
 * `workflowsPath` bundles register each export under its function name. The
 * dispatcher must NOT import the workflow modules: they call `proxyActivities`
 * at module load, which throws outside the workflow sandbox.
 */

export type DispatchPlan =
  | {
      readonly kind: 'start'
      readonly workflowType: string
      readonly workflowId: string
      /** Omitted ⇒ dispatcher uses the worker's default task queue. */
      readonly taskQueue?: string
      readonly args: readonly unknown[]
      readonly workflowRunTimeout: Duration
    }
  | { readonly kind: 'invalid'; readonly reason: string }

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isFinite(value)
  && Number.isInteger(value)
  && Number.isSafeInteger(value)
  && value > 0

/**
 * Per-environment task-queue names the dispatcher must agree with the workers on.
 *
 * `resolveDispatch` stays pure, so the queue names are injected rather than read
 * from env here. The worker that polls drip workflows is created with
 * `env.EMAIL_CAMPAIGNS_TASK_QUEUE` (apps/worker/src/index.ts); the dispatcher MUST
 * route `lifecycleEnrollmentWorkflow` to that same configured queue, not a
 * hardcoded literal, or any deployment that overrides the env var (e.g. each
 * worktree, per scripts/worktree/setup.sh) enqueues enrollments on a queue with
 * no poller and they never run.
 */
export interface DispatchConfig {
  readonly emailCampaignsTaskQueue: string
}

// Matches `defaultEmailCampaignsTaskQueue` in apps/worker/src/config/env.ts. Kept
// as a fallback only so existing single-arg callers/tests keep working; live
// callers MUST pass the resolved `env.EMAIL_CAMPAIGNS_TASK_QUEUE` so an override
// is honored.
const DEFAULT_EMAIL_CAMPAIGNS_TASK_QUEUE = 'email-campaigns'

export function resolveDispatch(
  event: SerializedDomainEvent,
  config: DispatchConfig = { emailCampaignsTaskQueue: DEFAULT_EMAIL_CAMPAIGNS_TASK_QUEUE }
): DispatchPlan {
  const payload = event.payload

  switch (event.eventType) {
    case 'organization.created': {
      const hasValidPayload =
        typeof payload.organizationName === 'string'
        && typeof payload.ownerUserId === 'string'
        && typeof payload.ownerEmail === 'string'

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid organization.created payload for event ${event.id}: missing organizationName, ownerUserId, or ownerEmail` }
      }

      return {
        kind: 'start',
        workflowType: 'organizationCreatedWorkflow',
        workflowId: `organization-created-${event.id}`,
        args: [event],
        workflowRunTimeout: '5 minutes'
      }
    }
    case 'organization.deleted': {
      const hasValidPayload =
        typeof payload.organizationId === 'string'
        && typeof payload.organizationName === 'string'
        && typeof payload.deletedByUserId === 'string'

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid organization.deleted payload for event ${event.id}: missing organizationId, organizationName, or deletedByUserId` }
      }

      return {
        kind: 'start',
        workflowType: 'organizationDeletedWorkflow',
        workflowId: `org-deleted-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'team.deleted': {
      const hasValidPayload =
        typeof payload.teamId === 'string'
        && typeof payload.teamName === 'string'
        && typeof payload.organizationId === 'string'
        && typeof payload.deletedByUserId === 'string'

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid team.deleted payload for event ${event.id}: missing teamId, teamName, organizationId, or deletedByUserId` }
      }

      return {
        kind: 'start',
        workflowType: 'teamDeletedWorkflow',
        workflowId: `team-deleted-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'assets.thumbnail_requested': {
      const hasValidPayload =
        typeof payload.teamId === 'string'
        && typeof payload.assetId === 'string'

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid assets.thumbnail_requested payload for event ${event.id}: missing teamId or assetId` }
      }

      return {
        kind: 'start',
        workflowType: 'assetThumbnailWorkflow',
        workflowId: `asset-thumbnail-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    // @spec INV-BILLING-010 — billing domain events fan out to one workflow per
    // event. Workflows are started independently of the dispatcher's progress.
    case 'billing.credits_purchased': {
      if (typeof payload.organizationId !== 'string') {
        return { kind: 'invalid', reason: `Invalid billing.credits_purchased payload for event ${event.id}: missing organizationId` }
      }

      return {
        kind: 'start',
        workflowType: 'creditsPurchasedWorkflow',
        workflowId: `billing-credits-purchased-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'billing.credits_recharged': {
      if (typeof payload.organizationId !== 'string') {
        return { kind: 'invalid', reason: `Invalid billing.credits_recharged payload for event ${event.id}: missing organizationId` }
      }

      return {
        kind: 'start',
        workflowType: 'creditsRechargedWorkflow',
        workflowId: `billing-credits-recharged-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'billing.credits_low_balance': {
      const hasValidPayload =
        typeof payload.organizationId === 'string'
        && typeof payload.currentBalanceDecimillicents === 'number'
        && typeof payload.thresholdDecimillicents === 'number'

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid billing.credits_low_balance payload for event ${event.id}: missing organizationId, currentBalanceDecimillicents, or thresholdDecimillicents` }
      }

      return {
        kind: 'start',
        workflowType: 'creditsLowBalanceWorkflow',
        workflowId: `billing-credits-low-balance-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'billing.usage_cap_warning': {
      const hasValidPayload =
        typeof payload.organizationId === 'string'
        && typeof payload.percentUsed === 'number'
        && typeof payload.capDecimillicents === 'number'

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid billing.usage_cap_warning payload for event ${event.id}: missing organizationId, percentUsed, or capDecimillicents` }
      }

      return {
        kind: 'start',
        workflowType: 'usageCapWarningWorkflow',
        workflowId: `billing-usage-cap-warning-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'billing.usage_cap_exceeded': {
      const hasValidPayload =
        typeof payload.organizationId === 'string'
        && typeof payload.capDecimillicents === 'number'

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid billing.usage_cap_exceeded payload for event ${event.id}: missing organizationId or capDecimillicents` }
      }

      return {
        kind: 'start',
        workflowType: 'usageCapExceededWorkflow',
        workflowId: `billing-usage-cap-exceeded-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'billing.payment_failed': {
      if (typeof payload.organizationId !== 'string') {
        return { kind: 'invalid', reason: `Invalid billing.payment_failed payload for event ${event.id}: missing organizationId` }
      }

      return {
        kind: 'start',
        workflowType: 'paymentFailedWorkflow',
        workflowId: `billing-payment-failed-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'billing.dispute_created': {
      if (typeof payload.organizationId !== 'string') {
        return { kind: 'invalid', reason: `Invalid billing.dispute_created payload for event ${event.id}: missing organizationId` }
      }

      return {
        kind: 'start',
        workflowType: 'disputeCreatedWorkflow',
        workflowId: `billing-dispute-created-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'billing.dispute_resolved': {
      const hasValidPayload =
        typeof payload.organizationId === 'string'
        && (payload.outcome === 'won' || payload.outcome === 'lost')
        && typeof payload.chargeAmountDecimillicents === 'number'
        && (payload.outcome === 'won' || isPositiveSafeInteger(payload.chargeAmountDecimillicents))

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid billing.dispute_resolved payload for event ${event.id}: missing organizationId, outcome ('won'|'lost'), or positive safe chargeAmountDecimillicents` }
      }

      return {
        kind: 'start',
        workflowType: 'disputeResolvedWorkflow',
        workflowId: `billing-dispute-resolved-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'billing.subscription_cancelled': {
      if (typeof payload.organizationId !== 'string') {
        return { kind: 'invalid', reason: `Invalid billing.subscription_cancelled payload for event ${event.id}: missing organizationId` }
      }

      return {
        kind: 'start',
        workflowType: 'subscriptionCancelledWorkflow',
        workflowId: `billing-subscription-cancelled-${event.id}`,
        args: [event],
        workflowRunTimeout: '10 minutes'
      }
    }
    case 'billing.credits_refunded': {
      // Emitted by charge.refunded handler for top-up refunds. Subscription
      // refunds are short-circuited upstream and never reach this event.
      if (typeof payload.organizationId !== 'string') {
        return { kind: 'invalid', reason: `Invalid billing.credits_refunded payload for event ${event.id}: missing organizationId` }
      }

      return {
        kind: 'start',
        workflowType: 'creditsRefundedWorkflow',
        workflowId: `billing-credits-refunded-${event.id}`,
        args: [event],
        workflowRunTimeout: '5 minutes'
      }
    }
    case 'billing.welcome_credit_granted': {
      // @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
      const hasValidPayload =
        typeof payload.organizationId === 'string'
        && typeof payload.amountDecimillicents === 'number'
        && typeof payload.plan === 'string'

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid billing.welcome_credit_granted payload for event ${event.id}: missing organizationId, amountDecimillicents, or plan` }
      }

      return {
        kind: 'start',
        workflowType: 'welcomeCreditGrantedWorkflow',
        workflowId: `billing-welcome-credit-granted-${event.id}`,
        args: [event],
        workflowRunTimeout: '5 minutes'
      }
    }
    case 'billing.recharge_requires_action': {
      // @spec billing-and-pricing-design §"3DS off-session challenge"
      const hasValidPayload =
        typeof payload.organizationId === 'string'
        && typeof payload.attemptId === 'string'
        && typeof payload.amountDecimillicents === 'number'
        && typeof payload.stripePaymentIntentId === 'string'
        && typeof payload.clientSecret === 'string'

      if (!hasValidPayload) {
        return { kind: 'invalid', reason: `Invalid billing.recharge_requires_action payload for event ${event.id}: missing organizationId, attemptId, amountDecimillicents, stripePaymentIntentId, or clientSecret` }
      }

      return {
        kind: 'start',
        workflowType: 'rechargeRequiresActionWorkflow',
        workflowId: `billing-recharge-requires-action-${event.id}`,
        args: [event],
        workflowRunTimeout: '5 minutes'
      }
    }
    // Lifecycle events all route to one bounded enrollment workflow (one short
    // run per event, NOT per enrollment and NOT sleeping). It looks up campaigns
    // whose domain_event trigger matches and writes enrollment rows stamped with
    // next_step_at; the drip sweep + reducer then drive progression. Routed to the
    // EMAIL_CAMPAIGNS queue (the injected config) where the campaign worker polls.
    case 'lifecycle.signed_up':
    case 'lifecycle.trial_started':
    case 'lifecycle.onboarding_completed':
    case 'lifecycle.workspace_activated':
    case 'lifecycle.feature_used':
    case 'lifecycle.inactive':
    case 'lifecycle.churned': {
      return {
        kind: 'start',
        workflowType: 'lifecycleEnrollmentWorkflow',
        workflowId: `lifecycle-enroll-${event.id}`,
        taskQueue: config.emailCampaignsTaskQueue,
        args: [event],
        workflowRunTimeout: '5 minutes'
      }
    }
    default:
      return { kind: 'invalid', reason: `Unknown event type '${event.eventType}'` }
  }
}
