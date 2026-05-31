import {
  proxyActivities
} from '@temporalio/workflow'
import { PAYMENT_GRACE_PERIOD_DAYS } from '@tx-agent-kit/contracts/constants'
import type { activities, SerializedDomainEvent } from './activities.js'
import type { billingActivities } from './billing-activities.js'

const {
  ping,
  resetStuckProcessingEvents,
  prunePublishedEvents,
  sendOrganizationWelcomeEmail,
  cleanExpiredUploadsActivity,
  cleanRetainedAssetsActivity,
  purgeOrganizationAssets,
  purgeTeamAssets
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second'
  }
})

const { generateAssetThumbnail } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5 seconds',
    maximumInterval: '1 minute',
    backoffCoefficient: 2
  }
})

// @spec INV-BILLING-010 — billing consumers are idempotent. The activity
// proxy retries with backoff; each activity is implemented so that a second
// execution of the same event produces the same terminal state.
const {
  creditPositiveReevaluate,
  triggerAutoRecharge,
  sendUsageCapWarning,
  applyUsageCapExceeded,
  startPaymentGracePeriod,
  freezeCreditBalance,
  resolveCreditDispute,
  scheduleOrgMediaPurge,
  notifyBillingEvent
} = proxyActivities<typeof billingActivities>({
  startToCloseTimeout: '60 seconds',
  retry: {
    maximumAttempts: 5,
    initialInterval: '1 second',
    maximumInterval: '30 seconds',
    backoffCoefficient: 2
  }
})

// @spec INV-BILLING-003 — reservation reclaim. A full scan across all stale
// reservations can take longer than the per-event 60s budget above, so the
// reclaim activity gets its own proxy with a much larger start-to-close.
const { releaseStaleReservations } = proxyActivities<typeof billingActivities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
    backoffCoefficient: 2
  }
})

// @spec billing-and-pricing-design §"Monthly Storage Reconciliation".
// The nightly sweep walks every org whose storage_usage rollup has
// rolled over and calls `reconcileMonthlyOverage` per tenant. A tenant
// base of a few thousand orgs can comfortably finish inside 15 minutes
// because each per-org call is a single SQL read + at most one ledger
// append. A generous start-to-close keeps headroom for future growth.
const { reconcileMonthlyStorageOverage } = proxyActivities<typeof billingActivities>({
  startToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '30 seconds',
    maximumInterval: '5 minutes',
    backoffCoefficient: 2
  }
})

// @spec billing-and-pricing-design §"Auto-recharge retry policy".
// The retry scan re-fires `triggerAutoRecharge` for every due row in the
// same activity invocation, so a busy backlog can spend several minutes
// inside a single call. Give it a generous start-to-close.
const { processDueAutoRechargeRetries } = proxyActivities<typeof billingActivities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
    backoffCoefficient: 2
  }
})

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isFinite(value)
  && Number.isInteger(value)
  && Number.isSafeInteger(value)
  && value > 0

export async function pingWorkflow(): Promise<{ ok: boolean }> {
  return ping()
}

export async function organizationCreatedWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationName = typeof event.payload.organizationName === 'string'
    ? event.payload.organizationName
    : undefined
  const ownerUserId = typeof event.payload.ownerUserId === 'string'
    ? event.payload.ownerUserId
    : undefined
  const ownerEmail = typeof event.payload.ownerEmail === 'string'
    ? event.payload.ownerEmail
    : undefined

  if (!organizationName || !ownerUserId || !ownerEmail) {
    throw new Error(
      `Invalid organization.created payload for event ${event.id}: missing organizationName, ownerUserId, or ownerEmail`
    )
  }

  await sendOrganizationWelcomeEmail({ organizationName, ownerUserId, ownerEmail })
}

export async function organizationDeletedWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const storagePaths = Array.isArray(event.payload.storagePaths)
    ? (event.payload.storagePaths as string[])
    : []

  await purgeOrganizationAssets(storagePaths)
}

export async function teamDeletedWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const storagePaths = Array.isArray(event.payload.storagePaths)
    ? (event.payload.storagePaths as string[])
    : []

  await purgeTeamAssets(storagePaths)
}

export async function assetThumbnailWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const teamId = typeof event.payload.teamId === 'string'
    ? event.payload.teamId
    : undefined
  const assetId = typeof event.payload.assetId === 'string'
    ? event.payload.assetId
    : undefined

  if (!teamId || !assetId) {
    throw new Error(`Invalid assets.thumbnail_requested payload for event ${event.id}: missing teamId or assetId`)
  }

  await generateAssetThumbnail({ teamId, assetId })
}

export async function resetStuckEventsWorkflow(
  stuckThresholdMinutes: number
): Promise<ReadonlyArray<string>> {
  return resetStuckProcessingEvents(stuckThresholdMinutes)
}

export async function prunePublishedEventsWorkflow(
  retentionDays: number
): Promise<number> {
  return prunePublishedEvents(retentionDays)
}

export async function retentionCleanerWorkflow(
  retentionHours: number
): Promise<void> {
  await cleanExpiredUploadsActivity()
  await cleanRetainedAssetsActivity(retentionHours)
}

// @spec INV-BILLING-010 — billing consumer workflows. Each validates its
// event payload, invokes the idempotent billing side-effect activity, then
// fans out the same event to notifications. Activities own dedup across
// retries.

export async function creditsPurchasedWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId
    : undefined

  if (!organizationId) {
    throw new Error(
      `Invalid billing.credits_purchased payload for event ${event.id}: missing organizationId`
    )
  }

  await creditPositiveReevaluate(organizationId)
  await notifyBillingEvent(event)
}

export async function creditsRechargedWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId
    : undefined

  if (!organizationId) {
    throw new Error(
      `Invalid billing.credits_recharged payload for event ${event.id}: missing organizationId`
    )
  }

  await creditPositiveReevaluate(organizationId)
  await notifyBillingEvent(event)
}

export async function creditsLowBalanceWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId
    : undefined
  const currentBalance = typeof event.payload.currentBalanceDecimillicents === 'number'
    ? event.payload.currentBalanceDecimillicents
    : undefined
  const threshold = typeof event.payload.thresholdDecimillicents === 'number'
    ? event.payload.thresholdDecimillicents
    : undefined

  if (!organizationId || currentBalance === undefined || threshold === undefined) {
    throw new Error(
      `Invalid billing.credits_low_balance payload for event ${event.id}: missing organizationId, currentBalanceDecimillicents, or thresholdDecimillicents`
    )
  }

  await triggerAutoRecharge(organizationId, currentBalance, threshold)
  await notifyBillingEvent(event)
}

export async function usageCapWarningWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId
    : undefined
  const percentUsed = typeof event.payload.percentUsed === 'number'
    ? event.payload.percentUsed
    : undefined
  const capDecimillicents = typeof event.payload.capDecimillicents === 'number'
    ? event.payload.capDecimillicents
    : undefined

  if (!organizationId || percentUsed === undefined || capDecimillicents === undefined) {
    throw new Error(
      `Invalid billing.usage_cap_warning payload for event ${event.id}: missing organizationId, percentUsed, or capDecimillicents`
    )
  }

  await sendUsageCapWarning(organizationId, percentUsed, capDecimillicents)
  await notifyBillingEvent(event)
}

export async function usageCapExceededWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId
    : undefined
  const capDecimillicents = typeof event.payload.capDecimillicents === 'number'
    ? event.payload.capDecimillicents
    : undefined

  if (!organizationId || capDecimillicents === undefined) {
    throw new Error(
      `Invalid billing.usage_cap_exceeded payload for event ${event.id}: missing organizationId or capDecimillicents`
    )
  }

  await applyUsageCapExceeded(organizationId, capDecimillicents)
  await notifyBillingEvent(event)
}

export async function paymentFailedWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId
    : undefined

  if (!organizationId) {
    throw new Error(
      `Invalid billing.payment_failed payload for event ${event.id}: missing organizationId`
    )
  }

  const gracePeriodEndsAt = typeof event.payload.gracePeriodEndsAt === 'string'
    ? event.payload.gracePeriodEndsAt
    : undefined

  await startPaymentGracePeriod(organizationId, PAYMENT_GRACE_PERIOD_DAYS, gracePeriodEndsAt)
  await notifyBillingEvent(event)
}

export async function disputeCreatedWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId
    : undefined

  if (!organizationId) {
    throw new Error(
      `Invalid billing.dispute_created payload for event ${event.id}: missing organizationId`
    )
  }

  await freezeCreditBalance(organizationId)
  await notifyBillingEvent(event)
}

export async function disputeResolvedWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId
    : undefined
  const outcome = event.payload.outcome === 'won' || event.payload.outcome === 'lost'
    ? event.payload.outcome
    : undefined
  const chargeAmountDecimillicents = typeof event.payload.chargeAmountDecimillicents === 'number'
    ? event.payload.chargeAmountDecimillicents
    : 0
  // The webhook handler carries the Stripe event id in the payload so
  // the worker can use `stripe:dispute-closed:<stripeEventId>` as the
  // ledger referenceId, matching the row the webhook itself wrote
  // inline. This makes resolveCreditDispute's append idempotent with
  // the webhook handler's write — no double-deduct on lost.
  const stripeEventId = typeof event.payload.stripeEventId === 'string'
    ? event.payload.stripeEventId
    : null

  if (!organizationId || !outcome) {
    throw new Error(
      `Invalid billing.dispute_resolved payload for event ${event.id}: missing organizationId or outcome`
    )
  }
  if (outcome === 'lost' && !isPositiveSafeInteger(chargeAmountDecimillicents)) {
    throw new Error(
      `Invalid billing.dispute_resolved payload for event ${event.id}: lost outcome requires positive safe chargeAmountDecimillicents`
    )
  }

  await resolveCreditDispute(organizationId, outcome, chargeAmountDecimillicents, stripeEventId)
  await notifyBillingEvent(event)
}

export async function subscriptionCancelledWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationId = typeof event.payload.organizationId === 'string'
    ? event.payload.organizationId
    : undefined

  if (!organizationId) {
    throw new Error(
      `Invalid billing.subscription_cancelled payload for event ${event.id}: missing organizationId`
    )
  }

  await scheduleOrgMediaPurge(organizationId)
  await notifyBillingEvent(event)
}

/**
 * Scheduled reclaim for orphaned credit reservations.
 *
 * Deterministic: no `Date.now`, no `Math.random` — the activity owns all
 * wall-clock reads. The workflow just delegates to the activity and returns
 * the count for observability. Temporal's schedule (see
 * `ensureReleaseStaleReservationsSchedule`) fires this every 10 minutes.
 *
 * @spec INV-BILLING-003 — reservation lifecycle: orphaned reservations are
 * reclaimed by a scheduled workflow after `maxAgeSeconds`.
 */
export async function releaseStaleReservationsWorkflow(
  maxAgeSeconds: number
): Promise<number> {
  return releaseStaleReservations(maxAgeSeconds)
}

/**
 * Hourly schedule workflow that re-fires `triggerAutoRecharge` for every
 * failed `auto_recharge_attempts` row whose `next_retry_at` has elapsed.
 * The activity owns wall-clock + DB access, so this workflow is just a
 * single delegating call (deterministic by construction).
 *
 * @spec billing-and-pricing-design §"Auto-recharge retry policy"
 */
export async function autoRechargeRetryWorkflow(): Promise<number> {
  return processDueAutoRechargeRetries()
}

/**
 * Nightly storage reconciliation workflow. Delegates to
 * {@link reconcileMonthlyStorageOverage} (the activity owns wall-clock
 * reads + DB access) so this workflow is deterministic by construction.
 * Temporal's schedule (see `ensureStorageReconcileSchedule`) fires this
 * at 03:00 UTC every day.
 *
 * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
 */
export async function storageReconcileWorkflow(): Promise<{
  candidateCount: number
  chargedCount: number
  totalChargedDecimillicents: number
  errorCount: number
}> {
  return reconcileMonthlyStorageOverage()
}

/**
 * Workflow handler for `billing.recharge_requires_action`. The event is
 * purely informational — the API push channel surfaces the 3DS challenge
 * URL to the frontend, no DB mutation is required. The workflow exists
 * solely so the outbox poller marks the event published once it has
 * been successfully fanned out, keeping the dispatcher symmetric with
 * every other billing event.
 *
 * Deterministic: no activities, no I/O. The dispatcher validates the
 * payload; by the time we get here the event is well-formed.
 *
 * @spec billing-and-pricing-design §"3DS off-session challenge"
 */
export async function rechargeRequiresActionWorkflow(
  event: SerializedDomainEvent
): Promise<{ acknowledged: true }> {
  await notifyBillingEvent(event)
  return { acknowledged: true }
}

/**
 * `billing.credits_refunded` consumer. Informational — downstream
 * notification fan-out renders the refund receipt.
 */
export async function creditsRefundedWorkflow(
  event: SerializedDomainEvent
): Promise<{ acknowledged: true }> {
  await notifyBillingEvent(event)
  return { acknowledged: true }
}

/**
 * `billing.welcome_credit_granted` consumer. Informational — the welcome
 * credit ledger entry and balance mutation are already committed by the
 * invoice.payment_succeeded handler. Notification fan-out sends the
 * welcome email via this workflow.
 *
 * @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
 */
export async function welcomeCreditGrantedWorkflow(
  event: SerializedDomainEvent
): Promise<{ acknowledged: true }> {
  await notifyBillingEvent(event)
  return { acknowledged: true }
}
