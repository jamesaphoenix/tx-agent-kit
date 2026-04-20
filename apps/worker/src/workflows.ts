import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common'
import {
  ParentClosePolicy,
  startChild,
  proxyActivities
} from '@temporalio/workflow'
import { PAYMENT_GRACE_PERIOD_DAYS } from '@tx-agent-kit/contracts/constants'
import type { activities, SerializedDomainEvent } from './activities.js'
import type { billingActivities } from './billing-activities.js'

const {
  ping,
  fetchUnprocessedEvents,
  markEventsPublished,
  markEventFailed,
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

export async function outboxPollerWorkflow(batchSize: number): Promise<void> {
  const events = await fetchUnprocessedEvents(batchSize)

  if (events.length === 0) {
    return
  }

  const dispatched: string[] = []

  for (const event of events) {
    try {
      switch (event.eventType) {
        case 'organization.created': {
          const hasValidPayload =
            typeof event.payload.organizationName === 'string'
            && typeof event.payload.ownerUserId === 'string'
            && typeof event.payload.ownerEmail === 'string'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid organization.created payload for event ${event.id}: missing organizationName, ownerUserId, or ownerEmail`)
            break
          }

          await startChild(organizationCreatedWorkflow, {
            workflowId: `organization-created-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '5 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'organization.deleted': {
          const hasValidPayload =
            typeof event.payload.organizationId === 'string'
            && typeof event.payload.organizationName === 'string'
            && typeof event.payload.deletedByUserId === 'string'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid organization.deleted payload for event ${event.id}: missing organizationId, organizationName, or deletedByUserId`)
            break
          }

          await startChild(organizationDeletedWorkflow, {
            workflowId: `org-deleted-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'team.deleted': {
          const hasValidPayload =
            typeof event.payload.teamId === 'string'
            && typeof event.payload.teamName === 'string'
            && typeof event.payload.organizationId === 'string'
            && typeof event.payload.deletedByUserId === 'string'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid team.deleted payload for event ${event.id}: missing teamId, teamName, organizationId, or deletedByUserId`)
            break
          }

          await startChild(teamDeletedWorkflow, {
            workflowId: `team-deleted-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'assets.thumbnail_requested': {
          const hasValidPayload =
            typeof event.payload.teamId === 'string'
            && typeof event.payload.assetId === 'string'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid assets.thumbnail_requested payload for event ${event.id}: missing teamId or assetId`)
            break
          }

          await startChild(assetThumbnailWorkflow, {
            workflowId: `asset-thumbnail-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        // @spec INV-BILLING-010 — billing domain events fan out to one
        // child workflow per event. Parent is ABANDON so the poller can
        // finish its batch independently of downstream completion.
        case 'billing.credits_purchased': {
          if (typeof event.payload.organizationId !== 'string') {
            await markEventFailed(event.id, `Invalid billing.credits_purchased payload for event ${event.id}: missing organizationId`)
            break
          }

          await startChild(creditsPurchasedWorkflow, {
            workflowId: `billing-credits-purchased-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.credits_recharged': {
          if (typeof event.payload.organizationId !== 'string') {
            await markEventFailed(event.id, `Invalid billing.credits_recharged payload for event ${event.id}: missing organizationId`)
            break
          }

          await startChild(creditsRechargedWorkflow, {
            workflowId: `billing-credits-recharged-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.credits_low_balance': {
          const hasValidPayload =
            typeof event.payload.organizationId === 'string'
            && typeof event.payload.currentBalanceDecimillicents === 'number'
            && typeof event.payload.thresholdDecimillicents === 'number'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid billing.credits_low_balance payload for event ${event.id}: missing organizationId, currentBalanceDecimillicents, or thresholdDecimillicents`)
            break
          }

          await startChild(creditsLowBalanceWorkflow, {
            workflowId: `billing-credits-low-balance-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.usage_cap_warning': {
          const hasValidPayload =
            typeof event.payload.organizationId === 'string'
            && typeof event.payload.percentUsed === 'number'
            && typeof event.payload.capDecimillicents === 'number'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid billing.usage_cap_warning payload for event ${event.id}: missing organizationId, percentUsed, or capDecimillicents`)
            break
          }

          await startChild(usageCapWarningWorkflow, {
            workflowId: `billing-usage-cap-warning-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.usage_cap_exceeded': {
          const hasValidPayload =
            typeof event.payload.organizationId === 'string'
            && typeof event.payload.capDecimillicents === 'number'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid billing.usage_cap_exceeded payload for event ${event.id}: missing organizationId or capDecimillicents`)
            break
          }

          await startChild(usageCapExceededWorkflow, {
            workflowId: `billing-usage-cap-exceeded-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.payment_failed': {
          if (typeof event.payload.organizationId !== 'string') {
            await markEventFailed(event.id, `Invalid billing.payment_failed payload for event ${event.id}: missing organizationId`)
            break
          }

          await startChild(paymentFailedWorkflow, {
            workflowId: `billing-payment-failed-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.dispute_created': {
          if (typeof event.payload.organizationId !== 'string') {
            await markEventFailed(event.id, `Invalid billing.dispute_created payload for event ${event.id}: missing organizationId`)
            break
          }

          await startChild(disputeCreatedWorkflow, {
            workflowId: `billing-dispute-created-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.dispute_resolved': {
          const hasValidPayload =
            typeof event.payload.organizationId === 'string'
            && (event.payload.outcome === 'won' || event.payload.outcome === 'lost')
            && typeof event.payload.chargeAmountDecimillicents === 'number'
            && (event.payload.outcome === 'won' || isPositiveSafeInteger(event.payload.chargeAmountDecimillicents))

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid billing.dispute_resolved payload for event ${event.id}: missing organizationId, outcome ('won'|'lost'), or positive safe chargeAmountDecimillicents`)
            break
          }

          await startChild(disputeResolvedWorkflow, {
            workflowId: `billing-dispute-resolved-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.subscription_cancelled': {
          if (typeof event.payload.organizationId !== 'string') {
            await markEventFailed(event.id, `Invalid billing.subscription_cancelled payload for event ${event.id}: missing organizationId`)
            break
          }

          await startChild(subscriptionCancelledWorkflow, {
            workflowId: `billing-subscription-cancelled-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '10 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.credits_refunded': {
          // Emitted by charge.refunded handler for top-up refunds. Subscription
          // refunds are short-circuited upstream and never reach this event.
          // The workflow is informational only — downstream notification
          // consumers (Phase 2) will render the refund receipt.
          if (typeof event.payload.organizationId !== 'string') {
            await markEventFailed(event.id, `Invalid billing.credits_refunded payload for event ${event.id}: missing organizationId`)
            break
          }

          await startChild(creditsRefundedWorkflow, {
            workflowId: `billing-credits-refunded-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '5 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.welcome_credit_granted': {
          // Emitted by invoice.payment_succeeded on first successful charge.
          // Informational only — Phase 2 notification handler will send the
          // welcome email.
          //
          // @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
          const hasValidPayload =
            typeof event.payload.organizationId === 'string'
            && typeof event.payload.amountDecimillicents === 'number'
            && typeof event.payload.plan === 'string'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid billing.welcome_credit_granted payload for event ${event.id}: missing organizationId, amountDecimillicents, or plan`)
            break
          }

          await startChild(welcomeCreditGrantedWorkflow, {
            workflowId: `billing-welcome-credit-granted-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '5 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'billing.recharge_requires_action': {
          // @spec billing-and-pricing-design §"3DS off-session challenge"
          // The event is informational only — the frontend listens on
          // its own push channel for the challenge URL. The dispatcher
          // still routes it through a no-op workflow so the outbox
          // poller marks it published and audit trails reflect the full
          // event flow.
          const hasValidPayload =
            typeof event.payload.organizationId === 'string'
            && typeof event.payload.attemptId === 'string'
            && typeof event.payload.amountDecimillicents === 'number'
            && typeof event.payload.stripePaymentIntentId === 'string'
            && typeof event.payload.clientSecret === 'string'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid billing.recharge_requires_action payload for event ${event.id}: missing organizationId, attemptId, amountDecimillicents, stripePaymentIntentId, or clientSecret`)
            break
          }

          await startChild(rechargeRequiresActionWorkflow, {
            workflowId: `billing-recharge-requires-action-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '5 minutes'
          })
          dispatched.push(event.id)
          break
        }
        case 'email_campaigns.enrollment_triggered': {
          const hasValidPayload =
            typeof event.payload.campaignId === 'string'
            && typeof event.payload.userId === 'string'
            && typeof event.payload.userEmail === 'string'
            && typeof event.payload.userName === 'string'
            && typeof event.payload.enrollmentId === 'string'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid email_campaigns.enrollment_triggered payload for event ${event.id}: missing campaignId, userId, userEmail, userName, or enrollmentId`)
            break
          }

          const campaignId = event.payload.campaignId as string
          const userId = event.payload.userId as string

          await startChild('dripSequenceWorkflow', {
            workflowId: `email-campaigns-enrollment-${event.id}`,
            taskQueue: 'email-campaigns',
            args: [{
              enrollmentId: event.payload.enrollmentId as string,
              campaignId,
              userId,
              userEmail: event.payload.userEmail as string,
              userName: event.payload.userName as string
            }],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '30 days'
          })
          dispatched.push(event.id)
          break
        }
        default:
          await markEventFailed(event.id, `Unknown event type '${event.eventType}'`)
          break
      }
    } catch (error: unknown) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        dispatched.push(event.id)
      } else {
        const message = error instanceof Error ? error.message : String(error)
        await markEventFailed(event.id, `Failed to dispatch child workflow for event type '${event.eventType}': ${message}`)
      }
    }
  }

  if (dispatched.length > 0) {
    await markEventsPublished(dispatched)
  }
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
