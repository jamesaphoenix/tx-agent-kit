import { createHmac, timingSafeEqual } from 'node:crypto'
import { Data } from 'effect'

export class WebhookVerificationError extends Data.TaggedError('WebhookVerificationError')<{
  readonly reason: string
}> {}

// --- Resend webhook event types ---

export interface ResendEmailSentEvent {
  readonly type: 'email.sent'
  readonly created_at: string
  readonly data: {
    readonly email_id: string
    readonly from: string
    readonly to: ReadonlyArray<string>
    readonly subject: string
  }
}

export interface ResendEmailDeliveredEvent {
  readonly type: 'email.delivered'
  readonly created_at: string
  readonly data: {
    readonly email_id: string
    readonly from: string
    readonly to: ReadonlyArray<string>
    readonly subject: string
  }
}

export interface ResendEmailBouncedEvent {
  readonly type: 'email.bounced'
  readonly created_at: string
  readonly data: {
    readonly email_id: string
    readonly from: string
    readonly to: ReadonlyArray<string>
    readonly subject: string
    readonly bounce: {
      readonly message: string
    }
  }
}

export interface ResendEmailComplainedEvent {
  readonly type: 'email.complained'
  readonly created_at: string
  readonly data: {
    readonly email_id: string
    readonly from: string
    readonly to: ReadonlyArray<string>
    readonly subject: string
  }
}

export interface ResendEmailOpenedEvent {
  readonly type: 'email.opened'
  readonly created_at: string
  readonly data: {
    readonly email_id: string
    readonly from: string
    readonly to: ReadonlyArray<string>
    readonly subject: string
  }
}

export interface ResendEmailClickedEvent {
  readonly type: 'email.clicked'
  readonly created_at: string
  readonly data: {
    readonly email_id: string
    readonly from: string
    readonly to: ReadonlyArray<string>
    readonly subject: string
    readonly click: {
      readonly link: string
    }
  }
}

export type ResendWebhookEvent =
  | ResendEmailSentEvent
  | ResendEmailDeliveredEvent
  | ResendEmailBouncedEvent
  | ResendEmailComplainedEvent
  | ResendEmailOpenedEvent
  | ResendEmailClickedEvent

const VALID_EVENT_TYPES = new Set([
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked'
])

/**
 * Verify a Resend webhook signature using HMAC-SHA256.
 *
 * Resend signs webhooks using the Svix library. The `svix-signature` header
 * contains one or more base64-encoded HMAC-SHA256 signatures (comma-separated,
 * each prefixed with `v1,`). The HMAC is computed over the string
 * `${svix-id}.${svix-timestamp}.${body}`.
 */
const WEBHOOK_TOLERANCE_SECONDS = 300

export const verifyResendWebhook = (input: {
  readonly payload: string
  readonly svixId: string
  readonly svixTimestamp: string
  readonly svixSignature: string
  readonly secret: string
}): boolean => {
  const { payload, svixId, svixTimestamp, svixSignature, secret } = input

  // Reject stale or future-dated webhooks to prevent replay attacks
  const timestampSeconds = Number(svixTimestamp)
  if (!Number.isFinite(timestampSeconds)) {
    return false
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS) {
    return false
  }

  // Resend/Svix secrets are prefixed with "whsec_" and the remainder is base64
  const secretBytes = Buffer.from(
    secret.startsWith('whsec_') ? secret.slice(6) : secret,
    'base64'
  )

  const signedContent = `${svixId}.${svixTimestamp}.${payload}`
  const expectedSignature = createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64')

  // The header may contain multiple signatures separated by spaces
  const signatures = svixSignature.split(' ')
  for (const sig of signatures) {
    const sigValue = sig.startsWith('v1,') ? sig.slice(3) : sig
    const expectedBuffer = Buffer.from(expectedSignature, 'base64')
    const receivedBuffer = Buffer.from(sigValue, 'base64')

    if (expectedBuffer.length === receivedBuffer.length) {
      if (timingSafeEqual(expectedBuffer, receivedBuffer)) {
        return true
      }
    }
  }

  return false
}

/**
 * Parse and validate a raw Resend webhook event body.
 */
export const parseResendWebhookEvent = (body: unknown): ResendWebhookEvent => {
  if (typeof body !== 'object' || body === null) {
    throw new WebhookVerificationError({ reason: 'Webhook body must be a non-null object' })
  }

  const record = body as Record<string, unknown>

  if (typeof record['type'] !== 'string') {
    throw new WebhookVerificationError({ reason: 'Webhook body missing "type" field' })
  }

  if (!VALID_EVENT_TYPES.has(record['type'])) {
    throw new WebhookVerificationError({
      reason: `Unknown webhook event type: ${record['type']}`
    })
  }

  if (typeof record['created_at'] !== 'string') {
    throw new WebhookVerificationError({ reason: 'Webhook body missing "created_at" field' })
  }

  if (typeof record['data'] !== 'object' || record['data'] === null) {
    throw new WebhookVerificationError({ reason: 'Webhook body missing "data" field' })
  }

  return body as ResendWebhookEvent
}
