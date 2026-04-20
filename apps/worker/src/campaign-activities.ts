import { createLogger } from '@tx-agent-kit/logging'
import {
  audienceRepository,
  campaignStepRepository,
  emailSendRepository,
  enrollmentRepository,
  suppressionRepository,
  unsubscribeRepository
} from '@tx-agent-kit/db'
import { Effect } from 'effect'
import { getWorkerEnv } from './config/env.js'

const logger = createLogger('tx-agent-kit-campaign-activities')
const resendEndpoint = 'https://api.resend.com/emails'

const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

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
// Template rendering (simple placeholder replacement)
// ---------------------------------------------------------------------------

const renderTemplate = (
  templateId: string,
  data: Record<string, unknown>,
  userName: string
): { html: string; text: string } => {
  const safeUserName = userName.replaceAll(/[\r\n]/g, '')

  // Build simple HTML + text from template data
  // In production this would use React Email or a template engine
  const body = typeof data.body === 'string'
    ? data.body
    : ''

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

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export const campaignActivities = {
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
   * Check if an enrollment is still in 'active' status.
   */
  checkEnrollmentActive: async (enrollmentId: string): Promise<boolean> => {
    const enrollment = await runEffect(enrollmentRepository.findById(enrollmentId))

    if (!enrollment) {
      logger.warn('Enrollment not found during active check.', { enrollmentId })
      return false
    }

    return enrollment.status === 'active'
  },

  /**
   * Check if an email address is on the suppression list.
   */
  checkSuppression: async (email: string): Promise<boolean> => {
    const isSuppressed = await runEffect(suppressionRepository.isSuppressed(email))

    if (isSuppressed) {
      logger.info('Email is suppressed.', { email })
    }

    return isSuppressed
  },

  /**
   * Check if a user has unsubscribed from a campaign (or globally).
   */
  checkUnsubscribed: async (userId: string, campaignId: string): Promise<boolean> => {
    // Check campaign-specific unsubscribe
    const campaignUnsub = await runEffect(unsubscribeRepository.isUnsubscribed(userId, campaignId))
    if (campaignUnsub) {
      return true
    }

    // Check global unsubscribe (campaignId = null)
    const globalUnsub = await runEffect(unsubscribeRepository.isUnsubscribed(userId, null))
    return globalUnsub
  },

  /**
   * Idempotent render-and-send for a single enrollment + step.
   *
   * 1. Check email_sends for (enrollmentId, stepId)
   * 2. If row exists with status beyond 'pending', skip (already sent)
   * 3. If no row, create with status 'pending'
   * 4. Render template
   * 5. Send via Resend (get messageId)
   * 6. Update row: status='sent', resendMessageId=messageId, sentAt=now()
   */
  renderAndSendEmail: async (input: RenderAndSendInput): Promise<void> => {
    const env = getWorkerEnv()

    // 1. Check for existing send record (idempotency)
    const existingSend = await runEffect(
      emailSendRepository.findByEnrollmentAndStep(input.enrollmentId, input.stepId)
    )

    // 2. If row exists with a terminal success status, skip (allow retries for 'failed' and 'pending')
    const terminalSuccessStatuses = ['sent', 'delivered', 'opened', 'clicked']
    if (existingSend && terminalSuccessStatuses.includes(existingSend.status)) {
      logger.info('Email already sent for enrollment+step, skipping.', {
        enrollmentId: input.enrollmentId,
        stepId: input.stepId,
        existingStatus: existingSend.status
      })
      return
    }

    // 3. Create pending send record if none exists
    let sendId: string
    if (!existingSend) {
      const created = await runEffect(
        emailSendRepository.create({
          enrollmentId: input.enrollmentId,
          stepId: input.stepId,
          campaignId: input.campaignId,
          userId: input.userId,
          toEmail: input.userEmail
        })
      )

      if (!created) {
        throw new Error(`Failed to create email send record for enrollment ${input.enrollmentId}, step ${input.stepId}`)
      }

      sendId = created.id
    } else {
      sendId = existingSend.id
    }

    // 4. Render template
    const templateData = toJsonRecord(input.templateData)
    const { html, text } = renderTemplate(input.templateId, templateData, input.userName)

    // 5. Send via Resend
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      logger.warn('Email delivery skipped because Resend is not configured.', {
        enrollmentId: input.enrollmentId,
        stepId: input.stepId
      })
      return
    }

    let resendMessageId: string
    try {
      const response = await fetch(resendEndpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL,
          to: [input.userEmail],
          subject: input.subject,
          html,
          text
        })
      })

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Resend request failed (${response.status}): ${body}`)
      }

      const result = (await response.json()) as { id?: string }
      resendMessageId = result.id ?? 'unknown'
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

    // 6. Atomically update row: status='sent', resendMessageId, sentAt
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
   * Advance enrollment to the next step.
   */
  advanceEnrollment: async (enrollmentId: string, stepOrder: number): Promise<void> => {
    const updated = await runEffect(
      enrollmentRepository.updateById(enrollmentId, {
        currentStepOrder: stepOrder
      })
    )

    if (!updated) {
      logger.warn('Failed to advance enrollment — not found.', { enrollmentId, stepOrder })
    } else {
      logger.info('Advanced enrollment.', { enrollmentId, stepOrder })
    }
  },

  /**
   * Mark enrollment as completed.
   */
  completeEnrollment: async (enrollmentId: string): Promise<void> => {
    const updated = await runEffect(
      enrollmentRepository.updateById(enrollmentId, {
        status: 'completed',
        completedAt: new Date()
      })
    )

    if (!updated) {
      logger.warn('Failed to complete enrollment — not found.', { enrollmentId })
    } else {
      logger.info('Completed enrollment.', { enrollmentId })
    }
  },

  /**
   * Cancel enrollment with a reason.
   */
  cancelEnrollmentActivity: async (
    enrollmentId: string,
    reason: 'user_unsubscribed' | 'suppressed' | 'admin_cancelled' | 'campaign_archived'
  ): Promise<void> => {
    const updated = await runEffect(
      enrollmentRepository.updateById(enrollmentId, {
        status: 'cancelled',
        cancelReason: reason,
        cancelledAt: new Date()
      })
    )

    if (!updated) {
      logger.warn('Failed to cancel enrollment — not found.', { enrollmentId, reason })
    } else {
      logger.info('Cancelled enrollment.', { enrollmentId, reason })
    }
  },

  /**
   * Resolve audience for a broadcast campaign.
   * Returns all users that are not suppressed and not unsubscribed.
   */
  resolveAudience: async (campaignId: string): Promise<ReadonlyArray<AudienceRecipient>> => {
    // For now, resolve all users as the audience.
    // In production, this would apply the campaign's audienceFilter.
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

      // Check unsubscribe (campaign-specific + global)
      const isUnsubscribed = await runEffect(
        unsubscribeRepository.isUnsubscribed(recipient.userId, input.campaignId)
      )
      const isGloballyUnsubscribed = isUnsubscribed
        ? true
        : await runEffect(unsubscribeRepository.isUnsubscribed(recipient.userId, null))

      if (isGloballyUnsubscribed) {
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

      // Render template
      const { html, text } = renderTemplate(
        input.templateId,
        input.templateData,
        recipient.name
      )

      // Send via Resend
      if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
        logger.warn('Broadcast email skipped — Resend not configured.', {
          campaignId: input.campaignId,
          userId: recipient.userId
        })
        skipped++
        continue
      }

      try {
        const response = await fetch(resendEndpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.RESEND_API_KEY}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            from: env.RESEND_FROM_EMAIL,
            to: [recipient.email],
            subject: input.subject,
            html,
            text
          })
        })

        if (!response.ok) {
          const body = await response.text()
          throw new Error(`Resend request failed (${response.status}): ${body}`)
        }

        const result = (await response.json()) as { id?: string }
        const resendMessageId = result.id ?? 'unknown'

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
