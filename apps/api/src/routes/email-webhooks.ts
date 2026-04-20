import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import type { EmailSendStatus } from '@tx-agent-kit/contracts'
import { EmailCampaignService } from '@tx-agent-kit/core'
import {
  verifyResendWebhook,
  parseResendWebhookEvent
} from '@tx-agent-kit/email'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect } from 'effect'
import { BadRequest, InternalError, TxAgentApi, mapCoreError } from '../api.js'
import { getApiEnv } from '../config/env.js'

const logger = createLogger('email-webhooks')

export const EmailWebhooksRouteKind = 'custom' as const

const RESEND_EVENT_TO_STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained'
}

export const EmailWebhooksLive = HttpApiBuilder.group(TxAgentApi, 'emailWebhooks', (handlers) =>
  handlers.handle('resendWebhook', () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest

      const svixId = request.headers['svix-id']
      const svixTimestamp = request.headers['svix-timestamp']
      const svixSignature = request.headers['svix-signature']

      if (!svixId || !svixTimestamp || !svixSignature) {
        return yield* Effect.fail(
          new BadRequest({ message: 'Missing Svix webhook signature headers' })
        )
      }

      const rawBody = yield* request.text.pipe(
        Effect.mapError((cause) =>
          new BadRequest({
            message: `Failed to read webhook request body: ${cause instanceof Error ? cause.message : String(cause)}`
          })
        )
      )

      const env = getApiEnv()
      const secret = env.RESEND_WEBHOOK_SECRET

      if (!secret) {
        logger.error('RESEND_WEBHOOK_SECRET not configured — cannot verify webhook')
        return yield* Effect.fail(
          new InternalError({ message: 'Webhook verification not configured' })
        )
      }

      const isValid = verifyResendWebhook({
        payload: rawBody,
        svixId,
        svixTimestamp,
        svixSignature,
        secret
      })

      if (!isValid) {
        return yield* Effect.fail(
          new BadRequest({ message: 'Invalid webhook signature' })
        )
      }

      const parsed = JSON.parse(rawBody) as unknown
      const event = parseResendWebhookEvent(parsed)

      const emailId = event.data.email_id
      const statusKey = RESEND_EVENT_TO_STATUS[event.type]

      if (!statusKey || !emailId) {
        logger.warn('Unhandled Resend webhook event type', { type: event.type })
        return { processed: false }
      }

      const service = yield* EmailCampaignService
      const now = new Date(event.created_at)

      const timestamps: Record<string, Date | null> = {}
      if (event.type === 'email.sent') {
        timestamps.sentAt = now
      }
      if (event.type === 'email.delivered') {
        timestamps.deliveredAt = now
      }
      if (event.type === 'email.opened') {
        timestamps.openedAt = now
      }
      if (event.type === 'email.clicked') {
        timestamps.clickedAt = now
      }
      if (event.type === 'email.bounced') {
        timestamps.bouncedAt = now
      }
      if (event.type === 'email.complained') {
        timestamps.complainedAt = now
      }

      yield* service
        .processWebhookEvent(
          emailId,
          statusKey as EmailSendStatus,
          timestamps
        )
        .pipe(Effect.mapError(mapCoreError))

      // For hard bounces and complaints, log for suppression handling.
      // Full suppression list integration is handled by the campaign worker.
      if (event.type === 'email.bounced' || event.type === 'email.complained') {
        logger.info('Email suppression event received', {
          type: event.type,
          emailId,
          to: event.data.to
        })
      }

      return { processed: true }
    })
  )
)
