import {
  audienceRepository,
  campaignRepository,
  campaignStepRepository,
  emailSendRepository,
  enrollmentRepository,
  suppressionRepository,
  unsubscribeRepository,
  usersRepository,
  type JsonObject
} from '@tx-agent-kit/db'
import { reduceEnrollment } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { getEmailEnv, renderEmailTemplate, type LifecycleEmailProps } from '@tx-agent-kit/email'
import { isAudiencePredicate, type AudiencePredicate } from '@tx-agent-kit/contracts'
import { resolveLifecycleCtaUrl } from './activities/cta-url.js'
import { sendViaResend } from './activities/resend-sender.js'
import { logger, runEffect } from './activities/shared.js'
import type { SerializedDomainEvent } from './activities.js'
import { extractLifecycleTarget } from './dispatch/lifecycle-enrollment-extractors.js'
import { getWorkerEnv } from './config/env.js'

// Resend honors an `Idempotency-Key` header for up to 24h: a duplicate POST
// with the same key returns the original send instead of delivering again.
// These keys are derived from the natural unique identity of a send so a
// Temporal activity retry (at-least-once) cannot double-deliver an email.
const dripIdempotencyKey = (enrollmentId: string, stepId: string): string =>
  `drip:${enrollmentId}:${stepId}`

const broadcastIdempotencyKey = (
  campaignId: string,
  stepId: string,
  userId: string
): string => `broadcast:${campaignId}:${stepId}:${userId}`

const isHostedRuntime = (nodeEnv: string): boolean => ['production', 'staging'].includes(nodeEnv.toLowerCase())

const logResendNotConfigured = (
  message: string,
  context: Record<string, unknown>,
  nodeEnv: string
): void => {
  if (isHostedRuntime(nodeEnv)) {
    logger.error(message, context, new Error('Resend is not configured'))
    return
  }
  logger.warn(message, context)
}

// Templates that carry a feedback CTA: the `has_not_left_feedback` audience
// predicate suppresses re-asking anyone who already clicked one of these.
const FEEDBACK_TEMPLATE_IDS = ['lifecycle/feedback-request', 'lifecycle/churned-feedback'] as const

// ---------------------------------------------------------------------------
// Serialized step type returned to workflows
// ---------------------------------------------------------------------------

export interface SerializedCampaignStep {
  id: string
  campaignId: string
  stepOrder: number
  subject: string
  templateId: string
  templateData: Record<string, unknown>
  delaySeconds: number
}

// ---------------------------------------------------------------------------
// Recipient type for audience resolution
// ---------------------------------------------------------------------------

export interface AudienceRecipient {
  userId: string
  email: string
  name: string
}

// ---------------------------------------------------------------------------
// Render-and-send input
// ---------------------------------------------------------------------------

export interface RenderAndSendInput {
  enrollmentId: string
  campaignId: string
  stepId: string
  userId: string
  userEmail: string
  userName: string
  subject: string
  templateId: string
  templateData: unknown
}

// ---------------------------------------------------------------------------
// Broadcast batch input + result
// ---------------------------------------------------------------------------

export interface SendBroadcastBatchInput {
  campaignId: string
  stepId: string
  subject: string
  templateId: string
  templateData: Record<string, unknown>
  recipients: ReadonlyArray<AudienceRecipient>
}

export interface SendBroadcastBatchResult {
  sent: number
  skipped: number
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

const renderFallback = (
  templateId: string,
  data: Record<string, unknown>,
  userName: string
): { html: string; text: string } => {
  const safeUserName = userName.replaceAll(/[\r\n]/g, '')
  const body = typeof data.body === 'string' ? data.body : ''

  const html = [
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">`,
    body
      ? `<p style="margin: 0 0 16px; color: #374151; line-height: 1.6;">${escapeHtml(body)}</p>`
      : `<p style="margin: 0 0 16px; color: #374151; line-height: 1.6;">Hello ${escapeHtml(safeUserName)},</p>`,
    `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />`,
    `<p style="margin: 0; color: #9ca3af; font-size: 12px;">Template: ${escapeHtml(templateId)}</p>`,
    `</div>`
  ].join('')

  const text = body || `Hello ${safeUserName},\n\nTemplate: ${templateId}`

  return { html, text }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#x27;')
}

const DEFAULT_WEB_BASE_URL = 'http://localhost:3000'

/**
 * Build the lifecycle render context (portable app-surface CTA URL + known
 * per-step values) and render via the real React Email registry. Falls back to
 * the minimal stub only for an unknown templateId (which should essentially
 * never happen - config templateIds are compile-checked against the registry).
 *
 * The starter kit's lifecycle emails are not team-scoped: every step's
 * `ctaSurface` resolves to an app-level SPA route (see resolveLifecycleCtaUrl).
 */
const renderEmailContent = async (
  templateId: string,
  templateData: Record<string, unknown>,
  userName: string
): Promise<{ html: string; text: string }> => {
  const baseUrl = getEmailEnv().WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL
  const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
  const ctaUrl = resolveLifecycleCtaUrl({
    ctaSurface: templateData.ctaSurface,
    ctaUrl: asString(templateData.ctaUrl),
    baseUrl
  })
  const props: LifecycleEmailProps = {
    userName,
    ctaUrl,
    appUrl: `${baseUrl.replace(/\/+$/, '')}/dashboard`,
    creditBalanceUsd: asString(templateData.creditBalanceUsd)
  }
  const rendered = await renderEmailTemplate(templateId, props)
  if (rendered !== null) {
    return rendered
  }
  logger.warn('Unknown email templateId; using minimal fallback.', { templateId })
  return renderFallback(templateId, templateData, userName)
}

// Lease window stamped on claimed rows so an overrunning/parallel sweep cannot
// re-grab a row whose send is in flight.
const SWEEP_LEASE_MS = 15 * 60 * 1000
// How many claimed enrollments the sweep processes at once. Kept under the DB
// request-pool cap, and the actual Resend sends are independently rate-limited
// (resend-sender), so this bound only overlaps render + DB work + send latency.
const SWEEP_SEND_CONCURRENCY = 6

const mapStopReason = (
  reason: 'cancelled' | 'paused' | 'suppressed' | 'unsubscribed'
): 'suppressed' | 'user_unsubscribed' | 'admin_cancelled' => {
  if (reason === 'suppressed') { return 'suppressed' }
  if (reason === 'unsubscribed') { return 'user_unsubscribed' }
  return 'admin_cancelled'
}

/**
 * Total map from audience predicate to "does this user fail the filter (exclude
 * from enrollment)?". A `Record<AudiencePredicate, ...>` so adding a predicate to
 * the union without an entry here is a compile error.
 */
const audienceExclusionChecks: Record<AudiencePredicate, (userId: string) => Promise<boolean>> = {
  // Audience = users who have NOT left feedback; exclude those who already
  // clicked a feedback email's CTA.
  has_not_left_feedback: (userId) =>
    runEffect(emailSendRepository.hasClickedFeedbackEmail(userId, FEEDBACK_TEMPLATE_IDS))
}

/**
 * True when the campaign's audience filter EXCLUDES this user (skip enrollment).
 * Evaluated at enroll time so, e.g., the churn feedback-ask is not sent to a user
 * who already left feedback. A null / unrecognized filter never excludes.
 */
const audienceExcludesUser = async (audienceFilter: JsonObject | null, userId: string): Promise<boolean> => {
  const type = audienceFilter?.type
  if (!isAudiencePredicate(type)) {
    return false
  }
  return audienceExclusionChecks[type](userId)
}

export const campaignActivities = {
  /**
   * Enroll the lifecycle event's user into every active campaign whose
   * domain_event trigger matches, stamping next_step_at = now + step1.delay so
   * the drip sweep picks it up. Skips unsubscribed users and already-active
   * enrollments. No email is sent here; the sweep + reducer drive sends.
   */
  enrollMatchingCampaigns: async (event: SerializedDomainEvent): Promise<void> => {
    const target = extractLifecycleTarget(event)
    if (target === null) {
      logger.warn('Lifecycle event has no enroll target; skipping.', {
        eventId: event.id,
        eventType: event.eventType
      })
      return
    }

    const { userId } = target
    const campaigns = await runEffect(
      campaignRepository.findActiveByCampaignTrigger({ type: 'domain_event', eventType: event.eventType })
    )

    for (const campaign of campaigns) {
      if (await runEffect(unsubscribeRepository.isUnsubscribedFromAny(userId, campaign.id))) {
        continue
      }

      // Honor the campaign's audience filter (e.g. don't send the feedback-ask to
      // someone who already left feedback).
      if (await audienceExcludesUser(campaign.audienceFilter, userId)) {
        continue
      }

      const existing = await runEffect(enrollmentRepository.findByCampaignAndUser(campaign.id, userId))
      if (existing?.status === 'active') {
        continue
      }

      const steps = await runEffect(campaignStepRepository.findByCampaign(campaign.id))
      const firstDelaySeconds = steps[0]?.delaySeconds ?? 0
      const nextStepAt = new Date(Date.now() + firstDelaySeconds * 1000)

      if (existing) {
        // Re-enroll a terminal enrollment in place (unique campaign+user). Clear
        // the prior cycle's email_sends rows first: they are keyed by
        // (enrollmentId, stepId) and this enrollment id is reused, so a leftover
        // `sent` row would satisfy renderAndSendEmail's idempotency check and
        // silently suppress every step of the new cycle (e.g. a second win-back
        // episode would deliver nothing).
        await runEffect(emailSendRepository.deleteByEnrollment(existing.id))
        await runEffect(
          enrollmentRepository.updateById(existing.id, {
            status: 'active',
            currentStepOrder: null,
            nextStepAt,
            pausedRemainingSecs: null,
            cancelReason: null,
            cancelledAt: null,
            completedAt: null,
            // Re-enrollment is a new cycle: record the event that re-triggered it.
            triggerEventType: event.eventType,
            triggerEventId: event.id
          })
        )
      } else {
        await runEffect(
          enrollmentRepository.create({
            campaignId: campaign.id,
            userId,
            nextStepAt,
            triggerEventType: event.eventType,
            triggerEventId: event.id
          })
        )
      }

      logger.info('Enrolled user into lifecycle campaign.', {
        eventType: event.eventType,
        campaignId: campaign.id,
        userId
      })
    }
  },

  /**
   * The drip SWEEP: claim due enrollments (FOR UPDATE SKIP LOCKED + lease), run
   * the pure reducer on each, send (idempotent) and advance. This replaces the
   * per-enrollment dripSequenceWorkflow - the enrollment row is the only state.
   */
  sweepDueEnrollments: async (
    batchSize: number
  ): Promise<{ claimed: number; sent: number; completed: number; stopped: number }> => {
    const now = new Date()
    const leaseUntil = new Date(now.getTime() + SWEEP_LEASE_MS)
    const claimed = await runEffect(enrollmentRepository.claimDue(now, batchSize, leaseUntil))

    if (claimed.length === 0) {
      return { claimed: 0, sent: 0, completed: 0, stopped: 0 }
    }

    // Batch every per-enrollment READ for the whole claimed set, so the sweep
    // issues a handful of queries instead of ~5 per enrollment (avoids DB
    // contention). The per-row WRITES (send + advance) stay per enrollment.
    const userIds = [...new Set(claimed.map((enrollment) => enrollment.userId))]
    const campaignIds = [...new Set(claimed.map((enrollment) => enrollment.campaignId))]

    // The independent reads run concurrently; suppression needs the resolved
    // emails, so it runs once the users read settles.
    const [users, allSteps, unsubRows] = await Promise.all([
      runEffect(usersRepository.findByIds(userIds)),
      runEffect(campaignStepRepository.findByCampaigns(campaignIds)),
      runEffect(unsubscribeRepository.findForUsers(userIds))
    ])

    const usersById = new Map(users.map((user) => [user.id, user]))

    const stepsByCampaign = new Map<string, Array<(typeof allSteps)[number]>>()
    for (const step of allSteps) {
      const list = stepsByCampaign.get(step.campaignId) ?? []
      list.push(step)
      stepsByCampaign.set(step.campaignId, list)
    }

    const suppressedEmails = new Set(
      (await runEffect(suppressionRepository.findSuppressed(users.map((user) => user.email)))).map((email) =>
        email.toLowerCase()
      )
    )

    const unsubByUser = new Map<string, { global: boolean; campaigns: Set<string> }>()
    for (const row of unsubRows) {
      const entry = unsubByUser.get(row.userId) ?? { global: false, campaigns: new Set<string>() }
      if (row.campaignId === null) {
        entry.global = true
      } else {
        entry.campaigns.add(row.campaignId)
      }
      unsubByUser.set(row.userId, entry)
    }

    // Process the claimed batch with bounded concurrency via Effect.forEach: the
    // reducer is pure, the Resend sends are rate-limited (resend-sender), and the
    // per-row writes overlap. Each enrollment returns its outcome; counters are
    // summed after so there is no shared-counter race. A send failure fails the
    // whole pass so Temporal retries (idempotent re-send), like the prior loop.
    const sweepOne = async (enrollment: (typeof claimed)[number]) => {
      const user = usersById.get(enrollment.userId)
      if (!user) {
        logger.warn('Enrollment user not found during sweep; skipping.', { enrollmentId: enrollment.id })
        return 'skip' as const
      }

      const steps = stepsByCampaign.get(enrollment.campaignId) ?? []
      const suppressed = suppressedEmails.has(user.email.toLowerCase())
      const unsub = unsubByUser.get(enrollment.userId)
      const unsubscribed = unsub !== undefined && (unsub.global || unsub.campaigns.has(enrollment.campaignId))

      const action = reduceEnrollment(
        {
          status: enrollment.status,
          currentStepOrder: enrollment.currentStepOrder,
          nextStepAt: enrollment.nextStepAt
        },
        steps,
        now,
        { suppressed, unsubscribed }
      )

      if (action.kind === 'send') {
        await campaignActivities.renderAndSendEmail({
          enrollmentId: enrollment.id,
          campaignId: enrollment.campaignId,
          stepId: action.step.id,
          userId: enrollment.userId,
          userEmail: user.email,
          userName: user.name,
          subject: action.step.subject,
          templateId: action.step.templateId,
          templateData: action.step.templateData
        })
        // Sending the LAST step returns nextStepAt = null. The due-queue index
        // excludes next_step_at IS NULL, so such a row would never be re-claimed
        // and would sit 'active' forever; complete it in the same advance.
        if (action.nextState.nextStepAt === null) {
          await runEffect(
            enrollmentRepository.advance(enrollment.id, {
              status: 'completed',
              currentStepOrder: action.nextState.currentStepOrder,
              nextStepAt: null,
              completedAt: now
            })
          )
          return 'sent-completed' as const
        }
        await runEffect(
          enrollmentRepository.advance(enrollment.id, {
            currentStepOrder: action.nextState.currentStepOrder,
            nextStepAt: action.nextState.nextStepAt
          })
        )
        return 'sent' as const
      }

      if (action.kind === 'complete') {
        await runEffect(
          enrollmentRepository.advance(enrollment.id, { status: 'completed', nextStepAt: null, completedAt: now })
        )
        return 'completed' as const
      }

      if (action.kind === 'stop') {
        await runEffect(
          enrollmentRepository.updateById(enrollment.id, {
            status: 'cancelled',
            cancelReason: mapStopReason(action.reason),
            cancelledAt: now,
            nextStepAt: null,
            sweepLeasedUntil: null
          })
        )
        return 'stopped' as const
      }

      // 'wait' => not due yet; leave for a later sweep (claim should not surface it).
      return 'skip' as const
    }

    const outcomes = await runEffect(
      Effect.forEach(claimed, (enrollment) => Effect.tryPromise(() => sweepOne(enrollment)), {
        concurrency: SWEEP_SEND_CONCURRENCY
      })
    )

    let sent = 0
    let completed = 0
    let stopped = 0
    for (const outcome of outcomes) {
      if (outcome === 'sent') {
        sent++
      } else if (outcome === 'sent-completed') {
        sent++
        completed++
      } else if (outcome === 'completed') {
        completed++
      } else if (outcome === 'stopped') {
        stopped++
      }
    }

    return { claimed: claimed.length, sent, completed, stopped }
  },

  /**
   * Fetch ordered campaign steps for a campaign.
   */
  fetchCampaignSteps: async (campaignId: string): Promise<ReadonlyArray<SerializedCampaignStep>> => {
    const steps = await runEffect(campaignStepRepository.findByCampaign(campaignId))

    return steps.map((step) => ({
      id: step.id,
      campaignId: step.campaignId,
      stepOrder: step.stepOrder,
      subject: step.subject,
      templateId: step.templateId,
      templateData: toJsonRecord(step.templateData),
      delaySeconds: step.delaySeconds
    }))
  },

  /**
   * Idempotent render-and-send for a single enrollment + step.
   *
   * 1. Upsert the (enrollmentId, stepId) send row (idempotent)
   * 2. If the row already reached a terminal success status, skip
   * 3. Render template
   * 4. Send via Resend (get messageId)
   * 5. Update row: status='sent', resendMessageId=messageId, sentAt=now()
   */
  renderAndSendEmail: async (input: RenderAndSendInput): Promise<void> => {
    const env = getWorkerEnv()

    // 1+2. Idempotency in one round-trip: upsert the (enrollment, step) send row.
    // Returns the existing row untouched on conflict (with its real status) or a
    // fresh 'pending' row. The partial-unique idempotency index makes this atomic,
    // so a concurrent activity retry cannot double-insert.
    const send = await runEffect(
      emailSendRepository.upsertDripSend({
        enrollmentId: input.enrollmentId,
        stepId: input.stepId,
        campaignId: input.campaignId,
        userId: input.userId,
        toEmail: input.userEmail
      })
    )
    if (!send) {
      throw new Error(`Failed to upsert email send record for enrollment ${input.enrollmentId}, step ${input.stepId}`)
    }

    // 2. If the row already reached a terminal success status, skip (retries are
    // still allowed for 'failed' and 'pending').
    const terminalSuccessStatuses = ['sent', 'delivered', 'opened', 'clicked']
    if (terminalSuccessStatuses.includes(send.status)) {
      logger.info('Email already sent for enrollment+step, skipping.', {
        enrollmentId: input.enrollmentId,
        stepId: input.stepId,
        existingStatus: send.status
      })
      return
    }

    const sendId = send.id

    // 3. Render template via the real React Email registry.
    const templateData = toJsonRecord(input.templateData)
    const { html, text } = await renderEmailContent(input.templateId, templateData, input.userName)

    // 4. Send via Resend
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      logResendNotConfigured('Email delivery skipped because Resend is not configured.', {
        enrollmentId: input.enrollmentId,
        stepId: input.stepId
      }, env.NODE_ENV)
      return
    }

    let resendMessageId: string
    try {
      // Rate-limited + 429-aware send (see resend-sender). The idempotency key is
      // derived from the natural (enrollment, step) identity: if the activity
      // crashes/times out after Resend returns 200 but before status='sent', the
      // row stays 'pending' and Temporal retries; the key makes Resend dedup the
      // re-POST instead of delivering twice.
      resendMessageId = await sendViaResend({
        apiKey: env.RESEND_API_KEY,
        from: env.RESEND_FROM_EMAIL,
        to: input.userEmail,
        subject: input.subject,
        html,
        text,
        idempotencyKey: dripIdempotencyKey(input.enrollmentId, input.stepId)
      })
    } catch (error) {
      logger.error(
        'Failed to send campaign email via Resend.',
        {
          enrollmentId: input.enrollmentId,
          stepId: input.stepId,
          userEmail: input.userEmail
        },
        error instanceof Error ? error : new Error(String(error))
      )

      // Mark send as failed
      await runEffect(
        emailSendRepository.updateStatus(sendId, 'failed', {
          failedReason: error instanceof Error ? error.message : String(error)
        })
      )

      throw error
    }

    // 5. Atomically update row: status='sent', resendMessageId, sentAt
    await runEffect(
      emailSendRepository.updateStatus(sendId, 'sent', {
        sentAt: new Date(),
        resendMessageId
      })
    )

    logger.info('Campaign email sent.', {
      enrollmentId: input.enrollmentId,
      stepId: input.stepId,
      userEmail: input.userEmail,
      resendMessageId
    })
  },

  /**
   * Resolve audience for a broadcast campaign.
   * Returns all users that are not suppressed and not unsubscribed.
   */
  resolveAudience: async (campaignId: string): Promise<ReadonlyArray<AudienceRecipient>> => {
    const recipients = await runEffect(audienceRepository.resolveAllUsers())

    logger.info('Resolved audience for broadcast.', {
      campaignId,
      recipientCount: recipients.length
    })

    return recipients
  },

  /**
   * Send a batch of broadcast emails, filtering out suppressed/unsubscribed.
   */
  sendBroadcastBatch: async (input: SendBroadcastBatchInput): Promise<SendBroadcastBatchResult> => {
    const env = getWorkerEnv()
    let sent = 0
    let skipped = 0

    for (const recipient of input.recipients) {
      // Check suppression
      const isSuppressed = await runEffect(suppressionRepository.isSuppressed(recipient.email))

      if (isSuppressed) {
        skipped++
        continue
      }

      // Check unsubscribe (campaign-specific + global) in one query.
      if (await runEffect(unsubscribeRepository.isUnsubscribedFromAny(recipient.userId, input.campaignId))) {
        skipped++
        continue
      }

      // Create send record
      const sendRecord = await runEffect(
        emailSendRepository.create({
          enrollmentId: null,
          stepId: input.stepId,
          campaignId: input.campaignId,
          userId: recipient.userId,
          toEmail: recipient.email
        })
      )

      if (!sendRecord) {
        skipped++
        continue
      }

      // Render template via the real React Email registry.
      const { html, text } = await renderEmailContent(
        input.templateId,
        toJsonRecord(input.templateData),
        recipient.name
      )

      // Send via Resend
      if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
        logResendNotConfigured('Broadcast email skipped - Resend not configured.', {
          campaignId: input.campaignId,
          userId: recipient.userId
        }, env.NODE_ENV)
        skipped++
        continue
      }

      try {
        // Rate-limited + 429-aware send (see resend-sender). The idempotency key
        // is the (campaign, step, recipient) identity, so a batch re-run dedups
        // recipients already sent instead of re-emailing them.
        const resendMessageId = await sendViaResend({
          apiKey: env.RESEND_API_KEY,
          from: env.RESEND_FROM_EMAIL,
          to: recipient.email,
          subject: input.subject,
          html,
          text,
          idempotencyKey: broadcastIdempotencyKey(input.campaignId, input.stepId, recipient.userId)
        })

        // Atomically update status + resendMessageId
        await runEffect(
          emailSendRepository.updateStatus(sendRecord.id, 'sent', {
            sentAt: new Date(),
            resendMessageId
          })
        )

        sent++
      } catch (error) {
        logger.error(
          'Failed to send broadcast email.',
          { campaignId: input.campaignId, userId: recipient.userId, email: recipient.email },
          error instanceof Error ? error : new Error(String(error))
        )

        await runEffect(
          emailSendRepository.updateStatus(sendRecord.id, 'failed', {
            failedReason: error instanceof Error ? error.message : String(error)
          })
        )

        skipped++
      }
    }

    logger.info('Broadcast batch complete.', {
      campaignId: input.campaignId,
      sent,
      skipped,
      total: input.recipients.length
    })

    return { sent, skipped }
  },

  /**
   * Prune old email sends beyond retention period.
   */
  pruneOldEmailSends: async (retentionDays: number): Promise<number> => {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60_000)
    const deleted = await runEffect(emailSendRepository.pruneOlderThan(cutoffDate))

    if (deleted > 0) {
      logger.info('Pruned old email sends.', { deleted, retentionDays })
    }

    return deleted
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toJsonRecord = (value: unknown): Record<string, unknown> => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}
