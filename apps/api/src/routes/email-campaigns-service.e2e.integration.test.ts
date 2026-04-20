import { createDbAuthContext, type ApiFactoryContext } from '@tx-agent-kit/testkit'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Service-level integration test for EmailCampaignService.
 *
 * Tests the service against a real Postgres database through the API server harness.
 * The API routes are thin wrappers around the service, so testing through HTTP exercises
 * the full service + adapter + DB stack.
 */

const apiPort = Number.parseInt(process.env.API_INTEGRATION_TEST_PORT_EMAIL_SVC ?? '4113', 10)
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
    schemaPrefix: 'email_svc'
  }
})

let factoryContext: ApiFactoryContext | undefined

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const requestJson = async <T>(path: string, caseName: string, init?: RequestInit): Promise<{ response: Response; body: T }> => {
  const existingHeaders: Record<string, string> = {}
  if (init?.headers) {
    const h = new Headers(init.headers)
    h.forEach((value, key) => { existingHeaders[key] = value })
  }
  const response = await fetch(`${dbAuthContext.baseUrl}${path}`, {
    ...init,
    headers: dbAuthContext.testContext.headersForCase(caseName, {
      'content-type': 'application/json',
      ...existingHeaders
    })
  })

  const body = await response.json() as T
  return { response, body }
}

beforeAll(async () => {
  await dbAuthContext.setup()
})

beforeEach(async () => {
  await dbAuthContext.reset()
  factoryContext = dbAuthContext.apiFactoryContext
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const createAdminWithOrg = async () => {
  if (!factoryContext) { throw new Error('Factory context was not initialized') }
  return dbAuthContext.createUserWithOrg()
}

const createCampaignViaApi = async (token: string, overrides?: Record<string, unknown>) => {
  return requestJson<{ id: string; name: string; status: string; campaignType: string }>(
    '/v1/admin/email-campaigns',
    'svc-create-campaign',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Service Test Campaign',
        campaignType: 'drip_sequence',
        ...overrides
      })
    }
  )
}

const addStepViaApi = async (token: string, campaignId: string, overrides?: Record<string, unknown>) => {
  return requestJson<{ id: string; campaignId: string; subject: string; templateId: string; delaySeconds: number; stepOrder: number }>(
    `/v1/admin/email-campaigns/${campaignId}/steps`,
    `svc-add-step-${campaignId}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        subject: 'Test Subject',
        templateId: 'test-template',
        delaySeconds: 0,
        ...overrides
      })
    }
  )
}

const activateCampaignViaApi = async (token: string, campaignId: string) => {
  return requestJson<{ id: string; status: string }>(
    `/v1/admin/email-campaigns/${campaignId}/activate`,
    `svc-activate-${campaignId}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    }
  )
}

// NOTE: kept serial for the same reason as email-campaigns.integration —
// the shared admin helper races under concurrent execution.
describe('EmailCampaignService integration', () => {
  // ---------------------------------------------------------------------------
  // INV-EMAIL-CAMP-001: Creates campaign with valid input
  // ---------------------------------------------------------------------------
  it('creates campaign with valid input and defaults to draft status [INV-EMAIL-CAMP-001]', async () => {
    const { token } = await createAdminWithOrg()

    const { response, body } = await createCampaignViaApi(token, {
      name: 'Welcome Drip',
      description: 'Onboarding series for new users',
      campaignType: 'drip_sequence'
    })

    expect(response.status).toBe(201)
    expect(body.name).toBe('Welcome Drip')
    expect(body.status).toBe('draft')
    expect(body.campaignType).toBe('drip_sequence')
    expect(body.id).toBeDefined()

    // Verify persisted in DB
    const dbRecord = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ name: string; status: string }>(
        'SELECT name, status FROM email_campaigns WHERE id = $1',
        [body.id]
      )
      return result.rows[0]
    })

    expect(dbRecord?.name).toBe('Welcome Drip')
    expect(dbRecord?.status).toBe('draft')
  })

  // ---------------------------------------------------------------------------
  // INV-EMAIL-CAMP-002: Step mutations only in draft status
  // ---------------------------------------------------------------------------
  describe('[INV-EMAIL-CAMP-002] step mutations restricted by campaign status', () => {
    it('allows adding steps to a draft campaign', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)

      const { response } = await addStepViaApi(token, campaign.id, {
        subject: 'Step 1',
        delaySeconds: 0
      })

      expect(response.status).toBe(201)
    })

    it('rejects adding steps to an active campaign', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      await addStepViaApi(token, campaign.id)
      await activateCampaignViaApi(token, campaign.id)

      const { response } = await addStepViaApi(token, campaign.id, { subject: 'Rejected Step' })
      expect(response.status).toBe(400)
    })

    it('rejects removing steps from an active campaign', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      const { body: step } = await addStepViaApi(token, campaign.id)
      await activateCampaignViaApi(token, campaign.id)

      const { response } = await requestJson(
        `/v1/admin/email-campaigns/${campaign.id}/steps/${step.id}`,
        'svc-remove-step-active',
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(400)
    })

    it('allows content-only updates (subject, templateData) on active campaign steps', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      const { body: step } = await addStepViaApi(token, campaign.id)
      await activateCampaignViaApi(token, campaign.id)

      // Subject-only update should succeed (no structural change)
      const { response, body } = await requestJson<{ id: string; subject: string }>(
        `/v1/admin/email-campaigns/${campaign.id}/steps/${step.id}`,
        'svc-update-step-content-only',
        {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ subject: 'Updated Subject on Active' })
        }
      )

      expect(response.status).toBe(200)
      expect(body.subject).toBe('Updated Subject on Active')
    })

    it('rejects structural step changes (delaySeconds) on active campaigns', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      await addStepViaApi(token, campaign.id)
      await activateCampaignViaApi(token, campaign.id)

      // Get step list to know step ID
      const { body: stepsList } = await requestJson<{ data: Array<{ id: string }> }>(
        `/v1/admin/email-campaigns/${campaign.id}/steps`,
        'svc-list-steps-for-structural',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      const { response } = await requestJson(
        `/v1/admin/email-campaigns/${campaign.id}/steps/${stepsList.data[0]!.id}`,
        'svc-update-step-structural',
        {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ delaySeconds: 7200 })
        }
      )

      expect(response.status).toBe(400)
    })
  })

  // ---------------------------------------------------------------------------
  // INV-EMAIL-CAMP-003: Rejects activation of campaign with zero steps
  // ---------------------------------------------------------------------------
  it('rejects activation of campaign with zero steps [INV-EMAIL-CAMP-003]', async () => {
    const { token } = await createAdminWithOrg()
    const { body: campaign } = await createCampaignViaApi(token)

    const { response, body } = await requestJson<{ message: string }>(
      `/v1/admin/email-campaigns/${campaign.id}/activate`,
      'svc-activate-no-steps',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` }
      }
    )

    expect(response.status).toBe(400)
    expect(body.message).toContain('at least one step')
  })

  // ---------------------------------------------------------------------------
  // INV-EMAIL-CAMP-004: State machine transitions
  // ---------------------------------------------------------------------------
  describe('[INV-EMAIL-CAMP-004] state machine transitions', () => {
    it('draft -> active (with steps)', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      await addStepViaApi(token, campaign.id)

      const { response, body } = await activateCampaignViaApi(token, campaign.id)
      expect(response.status).toBe(200)
      expect(body.status).toBe('active')
    })

    it('active -> paused', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      await addStepViaApi(token, campaign.id)
      await activateCampaignViaApi(token, campaign.id)

      const { response, body } = await requestJson<{ status: string }>(
        `/v1/admin/email-campaigns/${campaign.id}/pause`,
        'svc-pause',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      expect(response.status).toBe(200)
      expect(body.status).toBe('paused')
    })

    it('paused -> active', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      await addStepViaApi(token, campaign.id)
      await activateCampaignViaApi(token, campaign.id)

      await requestJson(
        `/v1/admin/email-campaigns/${campaign.id}/pause`,
        'svc-pause-for-resume',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const { response, body } = await requestJson<{ status: string }>(
        `/v1/admin/email-campaigns/${campaign.id}/resume`,
        'svc-resume',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      expect(response.status).toBe(200)
      expect(body.status).toBe('active')
    })

    it('active -> archived', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      await addStepViaApi(token, campaign.id)
      await activateCampaignViaApi(token, campaign.id)

      const { response, body } = await requestJson<{ status: string }>(
        `/v1/admin/email-campaigns/${campaign.id}/archive`,
        'svc-archive-from-active',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      expect(response.status).toBe(200)
      expect(body.status).toBe('archived')
    })

    it('paused -> archived', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      await addStepViaApi(token, campaign.id)
      await activateCampaignViaApi(token, campaign.id)

      await requestJson(
        `/v1/admin/email-campaigns/${campaign.id}/pause`,
        'svc-pause-for-archive',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const { response, body } = await requestJson<{ status: string }>(
        `/v1/admin/email-campaigns/${campaign.id}/archive`,
        'svc-archive-from-paused',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      expect(response.status).toBe(200)
      expect(body.status).toBe('archived')
    })

    it('rejects invalid: draft -> paused', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)

      const { response } = await requestJson(
        `/v1/admin/email-campaigns/${campaign.id}/pause`,
        'svc-invalid-draft-pause',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )
      expect(response.status).toBe(400)
    })

    it('rejects invalid: draft -> archived', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)

      const { response } = await requestJson(
        `/v1/admin/email-campaigns/${campaign.id}/archive`,
        'svc-invalid-draft-archive',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )
      expect(response.status).toBe(400)
    })

    it('rejects invalid: archived -> active', async () => {
      const { token } = await createAdminWithOrg()
      const { body: campaign } = await createCampaignViaApi(token)
      await addStepViaApi(token, campaign.id)
      await activateCampaignViaApi(token, campaign.id)

      await requestJson(
        `/v1/admin/email-campaigns/${campaign.id}/archive`,
        'svc-archive-for-reactivate',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const { response } = await requestJson(
        `/v1/admin/email-campaigns/${campaign.id}/resume`,
        'svc-invalid-archived-resume',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )
      expect(response.status).toBe(400)
    })
  })

  // ---------------------------------------------------------------------------
  // INV-EMAIL-CAMP-005: Step has subject, template, delay
  // ---------------------------------------------------------------------------
  it('creates step with subject, template, and delay [INV-EMAIL-CAMP-005]', async () => {
    const { token } = await createAdminWithOrg()
    const { body: campaign } = await createCampaignViaApi(token)

    const { response, body } = await addStepViaApi(token, campaign.id, {
      subject: 'Day 3: Your First Campaign',
      templateId: 'onboarding-day-3',
      templateData: { ctaUrl: 'https://app.example.com' },
      delaySeconds: 259_200
    })

    expect(response.status).toBe(201)
    expect(body.subject).toBe('Day 3: Your First Campaign')
    expect(body.templateId).toBe('onboarding-day-3')
    expect(body.delaySeconds).toBe(259_200)
    expect(body.stepOrder).toBeGreaterThanOrEqual(1)

    // Verify in DB
    const dbRecord = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ subject: string; template_id: string; delay_seconds: number }>(
        'SELECT subject, template_id, delay_seconds FROM email_campaign_steps WHERE id = $1',
        [body.id]
      )
      return result.rows[0]
    })

    expect(dbRecord?.subject).toBe('Day 3: Your First Campaign')
    expect(dbRecord?.template_id).toBe('onboarding-day-3')
    expect(dbRecord?.delay_seconds).toBe(259_200)
  })

  // ---------------------------------------------------------------------------
  // INV-EMAIL-CAMP-008: Rejects duplicate enrollment
  // ---------------------------------------------------------------------------
  it('rejects duplicate enrollment for same user and campaign [INV-EMAIL-CAMP-008]', async () => {
    const { token } = await createAdminWithOrg()
    const { body: campaign } = await createCampaignViaApi(token)
    await addStepViaApi(token, campaign.id)
    await activateCampaignViaApi(token, campaign.id)

    const enrollee = await dbAuthContext.createUser()

    // First enrollment - succeeds
    const { body: firstResult } = await requestJson<{ results: Array<{ enrolled: boolean }> }>(
      `/v1/admin/email-campaigns/${campaign.id}/enroll`,
      'svc-first-enroll',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ userIds: [enrollee.user.id] })
      }
    )
    expect(firstResult.results[0]!.enrolled).toBe(true)

    // Second enrollment - rejected (user already actively enrolled)
    const { body: secondResult } = await requestJson<{ results: Array<{ enrolled: boolean; error?: string }> }>(
      `/v1/admin/email-campaigns/${campaign.id}/enroll`,
      'svc-duplicate-enroll',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ userIds: [enrollee.user.id] })
      }
    )
    expect(secondResult.results[0]!.enrolled).toBe(false)
    expect(secondResult.results[0]!.error).toBeDefined()

    // Verify only one enrollment exists
    const dbCount = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT count(*) FROM email_campaign_enrollments WHERE campaign_id = $1 AND user_id = $2',
        [campaign.id, enrollee.user.id]
      )
      return Number.parseInt(result.rows[0]!.count, 10)
    })

    expect(dbCount).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // Archival cancels active enrollments [INV-EMAIL-CAMP-022]
  // ---------------------------------------------------------------------------
  it('archiving a campaign cancels all active enrollments [INV-EMAIL-CAMP-022]', async () => {
    const { token } = await createAdminWithOrg()
    const { body: campaign } = await createCampaignViaApi(token)
    await addStepViaApi(token, campaign.id)
    await activateCampaignViaApi(token, campaign.id)

    // Enroll two users
    const enrollee1 = await dbAuthContext.createUser()
    const enrollee2 = await dbAuthContext.createUser()

    await requestJson(
      `/v1/admin/email-campaigns/${campaign.id}/enroll`,
      'svc-enroll-for-archive',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ userIds: [enrollee1.user.id, enrollee2.user.id] })
      }
    )

    // Archive the campaign
    const { response } = await requestJson(
      `/v1/admin/email-campaigns/${campaign.id}/archive`,
      'svc-archive-with-enrollments',
      { method: 'POST', headers: { authorization: `Bearer ${token}` } }
    )
    expect(response.status).toBe(200)

    // Verify all enrollments are cancelled
    const activeCount = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT count(*) FROM email_campaign_enrollments WHERE campaign_id = $1 AND status = 'active'",
        [campaign.id]
      )
      return Number.parseInt(result.rows[0]!.count, 10)
    })

    expect(activeCount).toBe(0)

    const cancelledCount = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT count(*) FROM email_campaign_enrollments WHERE campaign_id = $1 AND status = 'cancelled'",
        [campaign.id]
      )
      return Number.parseInt(result.rows[0]!.count, 10)
    })

    expect(cancelledCount).toBe(2)
  })

  // ---------------------------------------------------------------------------
  // Re-enrollment after cancellation
  // ---------------------------------------------------------------------------
  it('allows re-enrollment after a previous enrollment was cancelled', async () => {
    const { token } = await createAdminWithOrg()
    const { body: campaign } = await createCampaignViaApi(token)
    await addStepViaApi(token, campaign.id)
    await activateCampaignViaApi(token, campaign.id)

    const enrollee = await dbAuthContext.createUser()

    // First enrollment
    await requestJson(
      `/v1/admin/email-campaigns/${campaign.id}/enroll`,
      'svc-enroll-first-time',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ userIds: [enrollee.user.id] })
      }
    )

    // Get enrollment ID and cancel it
    const { body: listBody } = await requestJson<{ data: Array<{ id: string }> }>(
      `/v1/admin/email-campaigns/${campaign.id}/enrollments`,
      'svc-list-for-cancel',
      { method: 'GET', headers: { authorization: `Bearer ${token}` } }
    )

    await requestJson(
      `/v1/admin/email-campaigns/${campaign.id}/enrollments/${listBody.data[0]!.id}/cancel`,
      'svc-cancel-for-re-enroll',
      { method: 'POST', headers: { authorization: `Bearer ${token}` } }
    )

    // Re-enroll the same user
    const { body: reEnrollResult } = await requestJson<{ results: Array<{ enrolled: boolean }> }>(
      `/v1/admin/email-campaigns/${campaign.id}/enroll`,
      'svc-re-enroll',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ userIds: [enrollee.user.id] })
      }
    )

    expect(reEnrollResult.results[0]!.enrolled).toBe(true)
  })
})
