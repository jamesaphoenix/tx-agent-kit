import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import type { EmailSendStatus, EmailSuppressionReason } from '@tx-agent-kit/contracts'
import { EmailCampaignService, SuppressionStorePort } from '@tx-agent-kit/core'
import {
  verifyResendWebhook,
  parseResendWebhookEvent
} from '@tx-agent-kit/email'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect } from 'effect'
import { BadRequest, InternalError, TxAgentApi, mapCoreError } from '../api.js'
import { getApiEnv } from '../config/env.js'

const logger = createLogger('tx-agent-kit-api').child('email-webhooks')

export const EmailWebhooksRouteKind = 'custom' as const

const RESEND_EVENT_TO_STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed'
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

      // Parse + validate inside Effect.try so a malformed (but signature-valid)
      // body becomes a typed BadRequest (400), not an Effect defect (500). A
      // synchronous throw in this generator would die and surface as a 500,
      // which Resend retries forever and can use to auto-disable the endpoint.
      const event = yield* Effect.try({
        try: () => parseResendWebhookEvent(JSON.parse(rawBody) as unknown),
        catch: (cause) =>
          new BadRequest({
            message: `Invalid Resend webhook payload: ${cause instanceof Error ? cause.message : String(cause)}`
          })
      })

      // Well-formed but unhandled event type (e.g. email.delivery_delayed,
      // email.scheduled): acknowledge with 2xx so Resend stops retrying.
      if (!event) {
        logger.warn('Skipping unhandled Resend webhook event type')
        return { processed: false }
      }

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

      // Hard bounces + spam complaints suppress the address so the drip sweep and
      // enroll stop emailing it (the send was looked up by resend message id, so
      // this is a campaigns-system suppression). Idempotent at the repo level.
      if (event.type === 'email.bounced' || event.type === 'email.complained') {
        const suppression = yield* SuppressionStorePort
        const reason: EmailSuppressionReason = event.type === 'email.bounced' ? 'hard_bounce' : 'complaint'
        const recipients = event.data.to
        yield* Effect.forEach(
          recipients,
          (address) =>
            suppression
              .suppress({ email: address, reason, sourceSystem: 'campaigns', sourceId: emailId })
              .pipe(Effect.mapError(mapCoreError)),
          { discard: true }
        )
        logger.info('Suppressed email address after bounce/complaint', {
          type: event.type,
          emailId,
          count: recipients.length
        })
      }

      // Post-acceptance provider failure: the send is now terminally 'failed'.
      // Log it so delivery problems surface to operators instead of staying
      // silently stuck at 'sent'.
      if (event.type === 'email.failed') {
        logger.warn('Email failed at provider after acceptance', {
          emailId,
          to: event.data.to,
          reason: event.data.failed?.reason
        })
      }

      return { processed: true }
    })
  )
)
