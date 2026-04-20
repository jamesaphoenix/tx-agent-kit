import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep
} from '@temporalio/workflow'
import type { campaignActivities } from './campaign-activities.js'

const {
  fetchCampaignSteps,
  checkEnrollmentActive,
  checkSuppression,
  checkUnsubscribed,
  renderAndSendEmail,
  advanceEnrollment,
  completeEnrollment,
  cancelEnrollmentActivity,
  resolveAudience,
  sendBroadcastBatch,
  pruneOldEmailSends
} = proxyActivities<typeof campaignActivities>({
  startToCloseTimeout: '60 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2 seconds'
  }
})

// ---------------------------------------------------------------------------
// Signals for external control of drip enrollments
// ---------------------------------------------------------------------------

export const cancelEnrollmentSignal = defineSignal('cancelEnrollment')
export const pauseEnrollmentSignal = defineSignal('pauseEnrollment')
export const resumeEnrollmentSignal = defineSignal('resumeEnrollment')

// ---------------------------------------------------------------------------
// Drip Sequence Workflow — one long-lived workflow per enrollment
// ---------------------------------------------------------------------------

export interface DripSequenceInput {
  enrollmentId: string
  campaignId: string
  userId: string
  userEmail: string
  userName: string
}

export async function dripSequenceWorkflow(input: DripSequenceInput): Promise<void> {
  // Signal-mutated state: use object wrapper so TypeScript tracks mutability correctly.
  // Temporal signal handlers mutate these between await points.
  const state = { cancelled: false, paused: false }

  setHandler(cancelEnrollmentSignal, () => {
    state.cancelled = true
  })
  setHandler(pauseEnrollmentSignal, () => {
    state.paused = true
  })
  setHandler(resumeEnrollmentSignal, () => {
    state.paused = false
  })

  const steps = await fetchCampaignSteps(input.campaignId)

  for (const step of steps) {
    // 1. Sleep for delay (durable timer)
    if (step.delaySeconds > 0) {
      await sleep(step.delaySeconds * 1000)
    }

    // 2. Wait while paused
    if (state.paused) {
      await condition(() => !state.paused || state.cancelled)
    }

    // 3. Check if cancelled
    if (state.cancelled) {
      break
    }

    // 4. Check enrollment still active
    const isActive = await checkEnrollmentActive(input.enrollmentId)
    if (!isActive) {
      break
    }

    // 5. Check suppression
    const isSuppressed = await checkSuppression(input.userEmail)
    if (isSuppressed) {
      await cancelEnrollmentActivity(input.enrollmentId, 'suppressed')
      break
    }

    // 6. Check unsubscribe
    const isUnsubscribed = await checkUnsubscribed(input.userId, input.campaignId)
    if (isUnsubscribed) {
      await cancelEnrollmentActivity(input.enrollmentId, 'user_unsubscribed')
      break
    }

    // 7. Render and send email (idempotent per enrollment+step)
    await renderAndSendEmail({
      enrollmentId: input.enrollmentId,
      campaignId: input.campaignId,
      stepId: step.id,
      userId: input.userId,
      userEmail: input.userEmail,
      userName: input.userName,
      subject: step.subject,
      templateId: step.templateId,
      templateData: step.templateData
    })

    // 8. Advance enrollment
    await advanceEnrollment(input.enrollmentId, step.stepOrder)
  }

  // Complete if not cancelled
  if (!state.cancelled) {
    await completeEnrollment(input.enrollmentId)
  }
}

// ---------------------------------------------------------------------------
// Broadcast Workflow — one per campaign send
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
  // 1. Resolve audience
  const recipients = await resolveAudience(input.campaignId)

  let sent = 0
  let skipped = 0

  // 2. Process in batches of 50
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
// Prune Email Sends Workflow — scheduled maintenance
// ---------------------------------------------------------------------------

export async function pruneEmailSendsWorkflow(retentionDays: number): Promise<number> {
  return pruneOldEmailSends(retentionDays)
}
