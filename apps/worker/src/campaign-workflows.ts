import { proxyActivities } from '@temporalio/workflow'
import type { SerializedDomainEvent } from './activities.js'
import type { campaignActivities } from './campaign-activities.js'

// NOTE: the per-enrollment `dripSequenceWorkflow` (a long-lived run that slept
// the cumulative per-step delays, with cancel/pause/resume signals) has been
// REMOVED. Drip progression is now driven by the reducer-based drip sweep
// (`dripSweepWorkflow` + `sweepDueEnrollments`). The enrollment row's
// `next_step_at` is the only progression state. This file keeps the bounded
// enrollment, broadcast and prune workflows, none of which sleep per enrollment.

const {
  enrollMatchingCampaigns,
  sweepDueEnrollments,
  resolveAudience,
  sendBroadcastBatch,
  pruneOldEmailSends
} = proxyActivities<typeof campaignActivities>({
  startToCloseTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2 seconds'
  }
})

// ---------------------------------------------------------------------------
// Lifecycle enrollment + drip sweep
// ---------------------------------------------------------------------------

/**
 * One short, bounded run per lifecycle event (NOT per enrollment, NOT sleeping):
 * looks up campaigns whose domain_event trigger matches and writes enrollment
 * rows stamped with next_step_at. The drip sweep + reducer drive progression.
 */
export async function lifecycleEnrollmentWorkflow(event: SerializedDomainEvent): Promise<void> {
  await enrollMatchingCampaigns(event)
}

/**
 * The drip SWEEP: one scheduled run drains the due queue in bounded batches,
 * applying the reducer to each due enrollment. Replaces every per-enrollment
 * sleeping dripSequenceWorkflow; Temporal cost is O(sweeps), not O(enrollments).
 */
export async function dripSweepWorkflow(batchSize: number, maxBatches: number): Promise<void> {
  for (let i = 0; i < maxBatches; i++) {
    const result = await sweepDueEnrollments(batchSize)
    if (result.claimed < batchSize) {
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Broadcast Workflow - one per campaign send
// ---------------------------------------------------------------------------

export interface BroadcastInput {
  campaignId: string
  stepId: string
  subject: string
  templateId: string
  templateData: Record<string, unknown>
}

export interface BroadcastResult {
  sent: number
  skipped: number
}

export async function broadcastWorkflow(input: BroadcastInput): Promise<BroadcastResult> {
  const recipients = await resolveAudience(input.campaignId)

  let sent = 0
  let skipped = 0

  const batchSize = 50
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize)
    const result = await sendBroadcastBatch({
      campaignId: input.campaignId,
      stepId: input.stepId,
      subject: input.subject,
      templateId: input.templateId,
      templateData: input.templateData,
      recipients: batch
    })
    sent += result.sent
    skipped += result.skipped
  }

  return { sent, skipped }
}

// ---------------------------------------------------------------------------
// Prune Email Sends Workflow - scheduled maintenance
// ---------------------------------------------------------------------------

export async function pruneEmailSendsWorkflow(retentionDays: number): Promise<number> {
  return pruneOldEmailSends(retentionDays)
}
