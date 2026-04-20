import { createDbAuthContext } from '@tx-agent-kit/testkit'
import {
  createEmailCampaignFactory,
  createEmailCampaignStepFactory,
  createEmailCampaignEnrollmentFactory,
  generateId
} from '@tx-agent-kit/db'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createUnsubscribeToken } from '../utils/unsubscribe-token.js'

const apiPort = Number.parseInt(process.env.API_INTEGRATION_TEST_PORT_EMAIL_UNSUB ?? '4112', 10)
const integrationAuthSecret = 'integration-auth-secret-minimum-32-chars'
const savedEnvValues = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY
}
process.env.AUTH_SECRET = integrationAuthSecret
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
    schemaPrefix: 'email_unsub'
  }
})

// ---------------------------------------------------------------------------
// Helper: seed an active campaign with enrollment directly in DB
// ---------------------------------------------------------------------------
const seedCampaignWithEnrollment = async (userId: string) => {
  return dbAuthContext.testContext.withSchemaClient(async (client) => {
    const campaignId = generateId()
    const stepId = generateId()
    const enrollmentId = generateId()

    // Note: userId comes from dbAuthContext.createUser() which already inserts
    // the user into the DB via the API. No need to seed a user here.

    const campaignSeed = createEmailCampaignFactory({
      id: campaignId,
      name: 'Unsub Test Campaign',
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

    return { campaignId, stepId, enrollmentId }
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

describe('email unsubscribe API integration', () => {
  // ---------------------------------------------------------------------------
  // GET /v1/email/unsubscribe — token verification
  // ---------------------------------------------------------------------------
  describe('GET /v1/email/unsubscribe', () => {
    it('verifies a valid unsubscribe token', async () => {
      const userId = generateId()
      const campaignId = generateId()

      const token = createUnsubscribeToken({ userId, campaignId }, integrationAuthSecret)

      const response = await fetch(
        `${dbAuthContext.baseUrl}/v1/email/unsubscribe?token=${encodeURIComponent(token)}`,
        {
          method: 'GET',
          headers: dbAuthContext.testContext.headersForCase('valid-unsub-token')
        }
      )

      expect(response.status).toBe(200)
      const body = await response.json() as { valid: boolean; userId: string; campaignId: string | null }
      expect(body.valid).toBe(true)
      expect(body.userId).toBe(userId)
      expect(body.campaignId).toBe(campaignId)
    })

    it('rejects an invalid/expired token', async () => {
      const response = await fetch(
        `${dbAuthContext.baseUrl}/v1/email/unsubscribe?token=invalid.token.here`,
        {
          method: 'GET',
          headers: dbAuthContext.testContext.headersForCase('invalid-unsub-token')
        }
      )

      expect(response.status).toBe(400)
    })

    it('rejects a request with missing token', async () => {
      const response = await fetch(
        `${dbAuthContext.baseUrl}/v1/email/unsubscribe`,
        {
          method: 'GET',
          headers: dbAuthContext.testContext.headersForCase('missing-unsub-token')
        }
      )

      expect(response.status).toBe(400)
    })
  })

  // ---------------------------------------------------------------------------
  // POST /v1/email/unsubscribe — process unsubscribe
  // ---------------------------------------------------------------------------
  describe('POST /v1/email/unsubscribe', () => {
    it('processes unsubscribe and cancels active enrollments [INV-EMAIL-CAMP-016]', async () => {
      // Create a real user so we have a valid user ID in the system
      const user = await dbAuthContext.createUser()
      const { campaignId, enrollmentId } = await seedCampaignWithEnrollment(user.user.id)

      const token = createUnsubscribeToken(
        { userId: user.user.id, campaignId },
        integrationAuthSecret
      )

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/email/unsubscribe`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...dbAuthContext.testContext.headersForCase('process-unsubscribe')
        },
        body: JSON.stringify({ token })
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { unsubscribed: boolean; userId: string; campaignId: string | null }
      expect(body.unsubscribed).toBe(true)
      expect(body.userId).toBe(user.user.id)
      expect(body.campaignId).toBe(campaignId)

      // Verify enrollment was cancelled
      const dbResult = await dbAuthContext.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ status: string; cancel_reason: string | null }>(
          'SELECT status, cancel_reason FROM email_campaign_enrollments WHERE id = $1',
          [enrollmentId]
        )
        return result.rows[0]
      })

      expect(dbResult?.status).toBe('cancelled')
      expect(dbResult?.cancel_reason).toBe('user_unsubscribed')

      // Verify unsubscribe record was created
      const unsubRecord = await dbAuthContext.testContext.withSchemaClient(async (client) => {
        const result = await client.query<{ user_id: string; campaign_id: string | null }>(
          'SELECT user_id, campaign_id FROM email_unsubscribes WHERE user_id = $1',
          [user.user.id]
        )
        return result.rows[0]
      })

      expect(unsubRecord?.user_id).toBe(user.user.id)
      expect(unsubRecord?.campaign_id).toBe(campaignId)
    })

    it('rejects unsubscribe with invalid token', async () => {
      const response = await fetch(`${dbAuthContext.baseUrl}/v1/email/unsubscribe`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...dbAuthContext.testContext.headersForCase('invalid-unsub-post-token')
        },
        body: JSON.stringify({ token: 'completely.invalid' })
      })

      expect(response.status).toBe(400)
    })

    it('processes global unsubscribe (no campaignId)', async () => {
      const user = await dbAuthContext.createUser()

      const token = createUnsubscribeToken(
        { userId: user.user.id },
        integrationAuthSecret
      )

      const response = await fetch(`${dbAuthContext.baseUrl}/v1/email/unsubscribe`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...dbAuthContext.testContext.headersForCase('global-unsubscribe')
        },
        body: JSON.stringify({ token })
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { unsubscribed: boolean; userId: string; campaignId: string | null }
      expect(body.unsubscribed).toBe(true)
      expect(body.campaignId).toBeNull()
    })
  })
})
