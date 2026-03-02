import { createLogger } from '@tx-agent-kit/logging'
import { domainEventsRepository } from '@tx-agent-kit/db'
import { Effect } from 'effect'
import { getWorkerEnv } from './config/env.js'

const logger = createLogger('tx-agent-kit-worker-activities')
const resendEndpoint = 'https://api.resend.com/emails'

const runEffect = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

const toJsonRecord = (value: unknown): Record<string, unknown> => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export interface SerializedDomainEvent {
  id: string
  eventType: string
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
  correlationId: string | null
  sequenceNumber: number
  status: string
  occurredAt: string
  processingAt: string | null
  publishedAt: string | null
  failedAt: string | null
  failureReason: string | null
  createdAt: string
}

export const activities = {
  ping: async (): Promise<{ ok: boolean }> => {
    logger.info('Ping activity executed.')
    return await Promise.resolve({ ok: true })
  },

  fetchUnprocessedEvents: async (batchSize: number): Promise<ReadonlyArray<SerializedDomainEvent>> => {
    const events = await runEffect(
      domainEventsRepository.fetchUnprocessed(batchSize)
    )

    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: toJsonRecord(event.payload),
      correlationId: event.correlationId,
      sequenceNumber: event.sequenceNumber,
      status: event.status,
      occurredAt: event.occurredAt.toISOString(),
      processingAt: event.processingAt ? event.processingAt.toISOString() : null,
      publishedAt: event.publishedAt ? event.publishedAt.toISOString() : null,
      failedAt: event.failedAt ? event.failedAt.toISOString() : null,
      failureReason: event.failureReason,
      createdAt: event.createdAt.toISOString()
    }))
  },

  markEventsPublished: async (eventIds: ReadonlyArray<string>): Promise<void> => {
    const result = await runEffect(
      domainEventsRepository.markPublished(eventIds)
    )
    if (result.updated < eventIds.length) {
      logger.warn('Some events were not in processing state during markPublished.', {
        expected: eventIds.length,
        updated: result.updated
      })
    }
    logger.info('Marked domain events as published.', { count: eventIds.length, updated: result.updated })
  },

  markEventFailed: async (eventId: string, reason: string): Promise<void> => {
    const result = await runEffect(
      domainEventsRepository.markFailed(eventId, reason)
    )
    if (result.updated === 0) {
      logger.warn('Event was not in processing state during markFailed.', { eventId })
    }
    logger.info('Marked domain event as failed.', { eventId, reason, updated: result.updated })
  },

  resetStuckProcessingEvents: async (stuckThresholdMinutes: number): Promise<ReadonlyArray<string>> => {
    const threshold = new Date(Date.now() - stuckThresholdMinutes * 60_000)
    const resetIds = await runEffect(
      domainEventsRepository.resetStuckProcessing(threshold)
    )
    if (resetIds.length > 0) {
      logger.warn('Reset stuck processing events back to pending.', {
        count: resetIds.length,
        thresholdMinutes: stuckThresholdMinutes,
        eventIds: resetIds
      })
    }
    return resetIds
  },

  prunePublishedEvents: async (retentionDays: number): Promise<number> => {
    const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60_000)
    const result = await runEffect(
      domainEventsRepository.prunePublished(olderThan)
    )
    if (result.deleted > 0) {
      logger.info('Pruned old published/failed domain events.', {
        deleted: result.deleted,
        retentionDays
      })
    }
    return result.deleted
  },

  sendOrganizationWelcomeEmail: async (payload: {
    organizationName: string
    ownerUserId: string
    ownerEmail: string
  }): Promise<void> => {
    const env = getWorkerEnv()

    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      logger.warn('Welcome email skipped because Resend is not configured.', {
        organizationName: payload.organizationName,
        ownerUserId: payload.ownerUserId
      })
      return
    }

    const dashboardUrl = env.WEB_BASE_URL ? `${env.WEB_BASE_URL}/dashboard` : undefined
    const safeName = payload.organizationName.replace(/[\r\n]/g, '')
    const subject = `Welcome to ${safeName}`
    const text = [
      `Your organization "${safeName}" has been created.`,
      '',
      ...(dashboardUrl ? [`Go to your dashboard: ${dashboardUrl}`, ''] : []),
      'You can invite team members from your organization settings.'
    ].join('\n')
    const html = [
      `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">`,
      `<h2 style="margin: 0 0 24px; font-size: 20px; font-weight: 600;">Welcome to ${escapeHtml(payload.organizationName)}</h2>`,
      `<p style="margin: 0 0 16px; color: #374151; line-height: 1.6;">Your organization has been created and is ready to use.</p>`,
      ...(dashboardUrl
        ? [
            `<div style="margin: 32px 0; text-align: center;">`,
            `<a href="${escapeHtml(dashboardUrl)}" style="display: inline-block; padding: 12px 32px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">Go to dashboard</a>`,
            `</div>`
          ]
        : []),
      `<p style="margin: 0 0 16px; color: #374151; line-height: 1.6;">You can invite team members from your organization settings.</p>`,
      `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />`,
      `<p style="margin: 0; color: #9ca3af; font-size: 12px;">You received this email because you created an organization.</p>`,
      `</div>`
    ].join('')

    try {
      const response = await fetch(resendEndpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL,
          to: [payload.ownerEmail],
          subject,
          html,
          text
        })
      })

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Resend request failed (${response.status}): ${body}`)
      }

      logger.info('Welcome email sent.', {
        organizationName: payload.organizationName,
        ownerEmail: payload.ownerEmail
      })
    } catch (error) {
      logger.error(
        'Failed to send welcome email.',
        {
          organizationName: payload.organizationName,
          ownerEmail: payload.ownerEmail
        },
        error instanceof Error ? error : new Error(String(error))
      )
      throw error
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
