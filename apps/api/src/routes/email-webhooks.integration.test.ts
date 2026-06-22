import { createDbAuthContext } from '@tx-agent-kit/testkit'
import {
  createEmailCampaignFactory,
  createEmailCampaignStepFactory,
  createEmailCampaignEnrollmentFactory,
  createEmailSendFactory,
  createUserFactory,
  generateId
} from '@tx-agent-kit/db'
import { createHmac } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const apiPort = Number.parseInt(process.env.API_INTEGRATION_TEST_PORT_EMAIL_WEBHOOKS ?? '4111', 10)
const integrationAuthSecret = 'integration-auth-secret-minimum-32-chars'
const savedEnvValues = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY
}

// The webhook secret must be base64-encoded. Resend/Svix prefixes with "whsec_"
const rawSecret = Buffer.from('test-webhook-secret-for-integration')
const webhookSecret = `whsec_${rawSecret.toString('base64')}`

process.env.AUTH_SECRET = integrationAuthSecret
process.env.RESEND_WEBHOOK_SECRET = webhookSecret
// Provide dummy R2 credentials so the API server can start in test mode
process.env.R2_ACCESS_KEY_ID ??= 'test-r2-access-key-id'
process.env.R2_SECRET_ACCESS_KEY ??= 'test-r2-secret-access-key'

const apiCwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const dbAuthContext = createDbAuthContext({
  apiCwd,
  host: '127.0.0.1',
  port: apiPort,
  authSecret: integrationAuthSecret,
  corsOrigin: 'http://localhost:3000',
  sql: {
    schemaPrefix: 'email_whook'
  }
})

// ---------------------------------------------------------------------------
// Helper: sign a webhook payload with Svix-style HMAC
// ---------------------------------------------------------------------------
const signWebhookPayload = (payload: string, svixId: string, svixTimestamp: string): string => {
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`
  const signature = createHmac('sha256', rawSecret)
    .update(signedContent)
    .digest('base64')
  return `v1,${signature}`
}

// ---------------------------------------------------------------------------
// Helper: seed campaign + step + enrollment + email_send via direct DB
// ---------------------------------------------------------------------------
const seedEmailSend = async (overrides?: { resendMessageId?: string; status?: string }) => {
  return dbAuthContext.testContext.withSchemaClient(async (client) => {
    const campaignId = generateId()
    const stepId = generateId()
    const enrollmentId = generateId()
    const userId = generateId()
    const resendMessageId = overrides?.resendMessageId ?? `resend-${generateId()}`

    // Seed a user to satisfy foreign key constraint
    const userSeed = createUserFactory({ id: userId })
    await client.query(
      `INSERT INTO users (id, email, password_hash, password_changed_at, name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userSeed.id, userSeed.email, userSeed.passwordHash, userSeed.passwordChangedAt, userSeed.name, userSeed.createdAt]
    )

    const campaignSeed = createEmailCampaignFactory({
      id: campaignId,
      name: 'Webhook Test Campaign',
      status: 'active'
    })
    await client.query(
      `INSERT INTO email_campaigns (id, name, description, campaign_type, status, trigger_config, audience_filter, from_name, reply_to, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        campaignSeed.id, campaignSeed.name, campaignSeed.description,
        campaignSeed.campaignType, campaignSeed.status, JSON.stringify(campaignSeed.triggerConfig),
        JSON.stringify(campaignSeed.audienceFilter), campaignSeed.fromName, campaignSeed.replyTo,
        campaignSeed.createdBy, campaignSeed.createdAt, campaignSeed.updatedAt
      ]
    )

    const stepSeed = createEmailCampaignStepFactory({ campaignId, id: stepId })
    await client.query(
      `INSERT INTO email_campaign_steps (id, campaign_id, step_order, subject, template_id, template_data, delay_seconds, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        stepSeed.id, stepSeed.campaignId, stepSeed.stepOrder, stepSeed.subject,
        stepSeed.templateId, JSON.stringify(stepSeed.templateData), stepSeed.delaySeconds,
        stepSeed.createdAt, stepSeed.updatedAt
      ]
    )

    const enrollmentSeed = createEmailCampaignEnrollmentFactory({
      campaignId,
      userId,
      id: enrollmentId,
      status: 'active'
    })
    await client.query(
      `INSERT INTO email_campaign_enrollments (id, campaign_id, user_id, status, current_step_order, temporal_workflow_id, enrolled_at, completed_at, cancelled_at, cancel_reason, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        enrollmentSeed.id, enrollmentSeed.campaignId, enrollmentSeed.userId,
        enrollmentSeed.status, enrollmentSeed.currentStepOrder, enrollmentSeed.temporalWorkflowId,
        enrollmentSeed.enrolledAt, enrollmentSeed.completedAt, enrollmentSeed.cancelledAt,
        enrollmentSeed.cancelReason, enrollmentSeed.createdAt, enrollmentSeed.updatedAt
      ]
    )

    const sendSeed = createEmailSendFactory({
      campaignId,
      stepId,
      userId,
      enrollmentId,
      resendMessageId,
      status: (overrides?.status ?? 'pending') as 'pending'
    })
    await client.query(
      `INSERT INTO email_sends (id, enrollment_id, campaign_id, step_id, user_id, to_email, resend_message_id, status, sent_at, delivered_at, opened_at, clicked_at, bounced_at, complained_at, failed_reason, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        sendSeed.id, sendSeed.enrollmentId, sendSeed.campaignId, sendSeed.stepId,
        sendSeed.userId, sendSeed.toEmail, sendSeed.resendMessageId, sendSeed.status,
        sendSeed.sentAt, sendSeed.deliveredAt, sendSeed.openedAt, sendSeed.clickedAt,
        sendSeed.bouncedAt, sendSeed.complainedAt, sendSeed.failedReason,
        JSON.stringify(sendSeed.metadata), sendSeed.createdAt
      ]
    )

    return { campaignId, stepId, enrollmentId, userId, resendMessageId, sendId: sendSeed.id }
  })
}

beforeAll(async () => {
  await dbAuthContext.setup()
})

beforeEach(async () => {
  await dbAuthContext.reset()
})

afterAll(async () => {
  await dbAuthContext.teardown()

  for (const [key, value] of Object.entries(savedEnvValues)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('email webhooks API integration', () => {
  // ---------------------------------------------------------------------------
  // HMAC signature verification
  // ---------------------------------------------------------------------------
  describe('signature verification', () => {
    it('rejects requests without signature headers', async () => {
      const response = await fetch(`${dbAuthContext.baseUrl}/v1/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...dbAuthContext.testContext.headersForCase('no-signature-headers')
        },
        body: JSON.stringify({ type: 'email.sent', data: {}, created_at: new Date().toISOString() })
      })

      expect(response.status).toBe(400)
    })

    it('rejects requests with invalid signature (invalid -> 400)', async () => {
      const payload = JSON.stringify({
        type: 'email.sent',
        created_at: new Date().toISOString(),
        data: { email_id: 'test-123', from: 'test@example.com', to: ['user@example.com'], subject: 'Test' }
      })
      const svixId = 'msg_test123'
      const svixTimestamp = String(Math.floor(Date.now() / 1000))

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': 'v1,invalidSignatureBase64Here',
          ...dbAuthContext.testContext.headersForCase('invalid-signature')
        },
        body: payload
      })

      expect(response.status).toBe(400)
    })

    it('accepts requests with valid signature (valid -> 200)', async () => {
      const { resendMessageId } = await seedEmailSend()

      const payload = JSON.stringify({
        type: 'email.sent',
        created_at: new Date().toISOString(),
        data: {
          email_id: resendMessageId,
          from: 'test@example.com',
          to: ['user@example.com'],
          subject: 'Test'
        }
      })
      const svixId = 'msg_validtest123'
      const svixTimestamp = String(Math.floor(Date.now() / 1000))
      const svixSignature = signWebhookPayload(payload, svixId, svixTimestamp)

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
          ...dbAuthContext.testContext.headersForCase('valid-signature')
        },
        body: payload
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { processed: boolean }
      expect(body.processed).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // INV-EMAIL-CAMP-013: Updates email_sends status from Resend webhook
  // ---------------------------------------------------------------------------
  describe('webhook event processing', () => {
    it('updates email_sends status from Resend webhook [INV-EMAIL-CAMP-013]', async () => {
      const { resendMessageId } = await seedEmailSend()

      // Send a "delivered" event
      const payload = JSON.stringify({
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: {
          email_id: resendMessageId,
          from: 'test@example.com',
          to: ['user@example.com'],
          subject: 'Delivered Email'
        }
      })
      const svixId = `msg_delivered_${generateId()}`
      const svixTimestamp = String(Math.floor(Date.now() / 1000))
      const svixSignature = signWebhookPayload(payload, svixId, svixTimestamp)

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
          ...dbAuthContext.testContext.headersForCase('delivered-webhook')
        },
        body: payload
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { processed: boolean }
      expect(body.processed).toBe(true)

      // Verify DB state was updated
      const dbResult = await dbAuthContext.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ status: string; delivered_at: Date | null }>(
          'SELECT status, delivered_at FROM email_sends WHERE resend_message_id = $1',
          [resendMessageId]
        )
        return result.rows[0]
      })

      expect(dbResult).toBeDefined()
      expect(dbResult?.status).toBe('delivered')
      expect(dbResult?.delivered_at).not.toBeNull()
    })

    it('processes bounce events [INV-EMAIL-CAMP-017]', async () => {
      const { resendMessageId } = await seedEmailSend()

      const payload = JSON.stringify({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          email_id: resendMessageId,
          from: 'test@example.com',
          to: ['bounced@example.com'],
          subject: 'Bounced Email',
          bounce: { message: 'Mailbox not found' }
        }
      })
      const svixId = `msg_bounce_${generateId()}`
      const svixTimestamp = String(Math.floor(Date.now() / 1000))
      const svixSignature = signWebhookPayload(payload, svixId, svixTimestamp)

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
          ...dbAuthContext.testContext.headersForCase('bounce-webhook')
        },
        body: payload
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { processed: boolean }
      expect(body.processed).toBe(true)

      // Verify status was updated to bounced
      const dbResult = await dbAuthContext.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ status: string; bounced_at: Date | null }>(
          'SELECT status, bounced_at FROM email_sends WHERE resend_message_id = $1',
          [resendMessageId]
        )
        return result.rows[0]
      })

      expect(dbResult?.status).toBe('bounced')
      expect(dbResult?.bounced_at).not.toBeNull()

      // A hard bounce suppresses the recipient address so the drip sweep stops
      // emailing it (campaigns-system suppression keyed on the resend message id).
      const suppression = await dbAuthContext.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ reason: string; source_system: string }>(
          'SELECT reason, source_system FROM email_suppression_list WHERE email = $1',
          ['bounced@example.com']
        )
        return result.rows[0]
      })
      expect(suppression?.reason).toBe('hard_bounce')
      expect(suppression?.source_system).toBe('campaigns')
    })

    it('processes complaint events and suppresses the address', async () => {
      const { resendMessageId } = await seedEmailSend()

      const payload = JSON.stringify({
        type: 'email.complained',
        created_at: new Date().toISOString(),
        data: {
          email_id: resendMessageId,
          from: 'test@example.com',
          to: ['complained@example.com'],
          subject: 'Complained Email'
        }
      })
      const svixId = `msg_complaint_${generateId()}`
      const svixTimestamp = String(Math.floor(Date.now() / 1000))
      const svixSignature = signWebhookPayload(payload, svixId, svixTimestamp)

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
          ...dbAuthContext.testContext.headersForCase('complaint-webhook')
        },
        body: payload
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { processed: boolean }
      expect(body.processed).toBe(true)

      const suppression = await dbAuthContext.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ reason: string }>(
          'SELECT reason FROM email_suppression_list WHERE email = $1',
          ['complained@example.com']
        )
        return result.rows[0]
      })
      expect(suppression?.reason).toBe('complaint')
    })

    it('processes email.failed events as a terminal failure', async () => {
      const { resendMessageId } = await seedEmailSend()

      const payload = JSON.stringify({
        type: 'email.failed',
        created_at: new Date().toISOString(),
        data: {
          email_id: resendMessageId,
          from: 'test@example.com',
          to: ['failed@example.com'],
          subject: 'Failed Email',
          failed: { reason: 'Provider rejected the message' }
        }
      })
      const svixId = `msg_failed_${generateId()}`
      const svixTimestamp = String(Math.floor(Date.now() / 1000))
      const svixSignature = signWebhookPayload(payload, svixId, svixTimestamp)

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
          ...dbAuthContext.testContext.headersForCase('failed-webhook')
        },
        body: payload
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { processed: boolean }
      expect(body.processed).toBe(true)

      const dbResult = await dbAuthContext.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ status: string }>(
          'SELECT status FROM email_sends WHERE resend_message_id = $1',
          [resendMessageId]
        )
        return result.rows[0]
      })
      expect(dbResult?.status).toBe('failed')
    })

    it('acknowledges well-formed but unhandled event types with processed: false', async () => {
      // email.delivery_delayed is a legitimate, well-formed Resend event we do not
      // map to a status transition. The parser returns null and the route 2xx-acks
      // so Resend stops retrying (a throw would be a 500 and retry forever).
      const payload = JSON.stringify({
        type: 'email.delivery_delayed',
        created_at: new Date().toISOString(),
        data: { email_id: 'test-123' }
      })
      const svixId = `msg_unhandled_${generateId()}`
      const svixTimestamp = String(Math.floor(Date.now() / 1000))
      const svixSignature = signWebhookPayload(payload, svixId, svixTimestamp)

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
          ...dbAuthContext.testContext.headersForCase('unhandled-event')
        },
        body: payload
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { processed: boolean }
      expect(body.processed).toBe(false)
    })

    it('rejects a structurally malformed payload with 400', async () => {
      // Missing the structural created_at/data fields: the parser throws, the
      // route maps it to a typed BadRequest (400), not a 500 defect.
      const payload = JSON.stringify({ type: 'email.bounced' })
      const svixId = `msg_malformed_${generateId()}`
      const svixTimestamp = String(Math.floor(Date.now() / 1000))
      const svixSignature = signWebhookPayload(payload, svixId, svixTimestamp)

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/webhooks/resend`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
          ...dbAuthContext.testContext.headersForCase('malformed-event')
        },
        body: payload
      })

      expect(response.status).toBe(400)
    })
  })
})
