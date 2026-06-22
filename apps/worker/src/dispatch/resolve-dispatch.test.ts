import { describe, it, expect } from 'vitest'
import type { SerializedDomainEvent } from '../activities.js'
import { resolveDispatch } from './resolve-dispatch.js'

const makeEvent = (
  eventType: string,
  payload: Record<string, unknown>
): SerializedDomainEvent => ({
  id: 'evt-1',
  eventType,
  aggregateType: 'test',
  aggregateId: 'agg-1',
  payload,
  correlationId: null,
  sequenceNumber: 1,
  status: 'pending',
  occurredAt: '2026-01-01T00:00:00.000Z',
  processingAt: null,
  publishedAt: null,
  failedAt: null,
  failureReason: null,
  createdAt: '2026-01-01T00:00:00.000Z'
})

/** One representative valid payload per event type. */
const validCases: ReadonlyArray<{
  eventType: string
  payload: Record<string, unknown>
  workflowType: string
  workflowId: string
  workflowRunTimeout: string
  taskQueue?: string
}> = [
  { eventType: 'organization.created', payload: { organizationName: 'Acme', ownerUserId: 'u1', ownerEmail: 'a@b.co' }, workflowType: 'organizationCreatedWorkflow', workflowId: 'organization-created-evt-1', workflowRunTimeout: '5 minutes' },
  { eventType: 'organization.deleted', payload: { organizationId: 'o1', organizationName: 'Acme', deletedByUserId: 'u1' }, workflowType: 'organizationDeletedWorkflow', workflowId: 'org-deleted-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'team.deleted', payload: { teamId: 't1', teamName: 'T', organizationId: 'o1', deletedByUserId: 'u1' }, workflowType: 'teamDeletedWorkflow', workflowId: 'team-deleted-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'assets.thumbnail_requested', payload: { teamId: 't1', assetId: 'a1' }, workflowType: 'assetThumbnailWorkflow', workflowId: 'asset-thumbnail-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.credits_purchased', payload: { organizationId: 'o1' }, workflowType: 'creditsPurchasedWorkflow', workflowId: 'billing-credits-purchased-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.credits_recharged', payload: { organizationId: 'o1' }, workflowType: 'creditsRechargedWorkflow', workflowId: 'billing-credits-recharged-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.credits_low_balance', payload: { organizationId: 'o1', currentBalanceDecimillicents: 1, thresholdDecimillicents: 2 }, workflowType: 'creditsLowBalanceWorkflow', workflowId: 'billing-credits-low-balance-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.usage_cap_warning', payload: { organizationId: 'o1', percentUsed: 80, capDecimillicents: 100 }, workflowType: 'usageCapWarningWorkflow', workflowId: 'billing-usage-cap-warning-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.usage_cap_exceeded', payload: { organizationId: 'o1', capDecimillicents: 100 }, workflowType: 'usageCapExceededWorkflow', workflowId: 'billing-usage-cap-exceeded-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.payment_failed', payload: { organizationId: 'o1' }, workflowType: 'paymentFailedWorkflow', workflowId: 'billing-payment-failed-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.dispute_created', payload: { organizationId: 'o1' }, workflowType: 'disputeCreatedWorkflow', workflowId: 'billing-dispute-created-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.dispute_resolved', payload: { organizationId: 'o1', outcome: 'lost', chargeAmountDecimillicents: 100 }, workflowType: 'disputeResolvedWorkflow', workflowId: 'billing-dispute-resolved-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.subscription_cancelled', payload: { organizationId: 'o1' }, workflowType: 'subscriptionCancelledWorkflow', workflowId: 'billing-subscription-cancelled-evt-1', workflowRunTimeout: '10 minutes' },
  { eventType: 'billing.credits_refunded', payload: { organizationId: 'o1' }, workflowType: 'creditsRefundedWorkflow', workflowId: 'billing-credits-refunded-evt-1', workflowRunTimeout: '5 minutes' },
  { eventType: 'billing.welcome_credit_granted', payload: { organizationId: 'o1', amountDecimillicents: 100, plan: 'plan-under-test' }, workflowType: 'welcomeCreditGrantedWorkflow', workflowId: 'billing-welcome-credit-granted-evt-1', workflowRunTimeout: '5 minutes' },
  { eventType: 'billing.recharge_requires_action', payload: { organizationId: 'o1', attemptId: 'at1', amountDecimillicents: 100, stripePaymentIntentId: 'pi1', clientSecret: 'cs1' }, workflowType: 'rechargeRequiresActionWorkflow', workflowId: 'billing-recharge-requires-action-evt-1', workflowRunTimeout: '5 minutes' }
]

// Every lifecycle.* event routes to one bounded enrollment workflow on the
// email-campaigns queue. Unlike the cases above, lifecycle events carry no
// dispatcher-validated required fields (the raw event is forwarded), so they do
// NOT belong in the "rejects empty payload" table.
const lifecycleEventTypes = [
  'lifecycle.signed_up',
  'lifecycle.trial_started',
  'lifecycle.onboarding_completed',
  'lifecycle.workspace_activated',
  'lifecycle.feature_used',
  'lifecycle.inactive',
  'lifecycle.churned'
] as const

describe('resolveDispatch', () => {
  for (const c of validCases) {
    it(`maps ${c.eventType} to a start plan`, () => {
      const plan = resolveDispatch(makeEvent(c.eventType, c.payload))
      expect(plan.kind).toBe('start')
      if (plan.kind !== 'start') { return }
      expect(plan.workflowType).toBe(c.workflowType)
      expect(plan.workflowId).toBe(c.workflowId)
      expect(plan.workflowRunTimeout).toBe(c.workflowRunTimeout)
      expect(plan.taskQueue).toBe(c.taskQueue)
      expect(plan.args.length).toBeGreaterThan(0)
    })

    it(`rejects ${c.eventType} with an empty payload`, () => {
      const plan = resolveDispatch(makeEvent(c.eventType, {}))
      expect(plan.kind).toBe('invalid')
      if (plan.kind !== 'invalid') { return }
      expect(plan.reason).toContain(c.eventType)
      expect(plan.reason).toContain('evt-1')
    })
  }

  for (const eventType of lifecycleEventTypes) {
    it(`routes ${eventType} to lifecycleEnrollmentWorkflow on the configured email queue`, () => {
      const plan = resolveDispatch(
        makeEvent(eventType, { userId: 'u1' }),
        { emailCampaignsTaskQueue: 'custom-email-queue' }
      )
      expect(plan.kind).toBe('start')
      if (plan.kind !== 'start') { return }
      expect(plan.workflowType).toBe('lifecycleEnrollmentWorkflow')
      expect(plan.workflowId).toBe('lifecycle-enroll-evt-1')
      expect(plan.taskQueue).toBe('custom-email-queue')
      expect(plan.workflowRunTimeout).toBe('5 minutes')
      // The RAW event is forwarded (the sweep looks up the user later).
      expect(plan.args[0]).toMatchObject({ eventType, payload: { userId: 'u1' } })
    })
  }

  it('falls back to the default email-campaigns queue when no config is passed', () => {
    const plan = resolveDispatch(makeEvent('lifecycle.signed_up', { userId: 'u1' }))
    expect(plan.kind).toBe('start')
    if (plan.kind !== 'start') { return }
    expect(plan.taskQueue).toBe('email-campaigns')
  })

  it('rejects dispute_resolved with a negative charge amount when lost', () => {
    const plan = resolveDispatch(makeEvent('billing.dispute_resolved', {
      organizationId: 'o1', outcome: 'lost', chargeAmountDecimillicents: -5
    }))
    expect(plan.kind).toBe('invalid')
  })

  it('allows dispute_resolved won with zero charge amount', () => {
    const plan = resolveDispatch(makeEvent('billing.dispute_resolved', {
      organizationId: 'o1', outcome: 'won', chargeAmountDecimillicents: 0
    }))
    expect(plan.kind).toBe('start')
  })

  it('marks an unknown event type invalid', () => {
    const plan = resolveDispatch(makeEvent('totally.unknown', { foo: 'bar' }))
    expect(plan.kind).toBe('invalid')
    if (plan.kind !== 'invalid') { return }
    expect(plan.reason).toContain("Unknown event type 'totally.unknown'")
  })
})
