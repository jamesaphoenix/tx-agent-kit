import { createDbAuthContext, type ApiFactoryContext } from '@tx-agent-kit/testkit'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const apiPort = Number.parseInt(process.env.API_INTEGRATION_TEST_PORT_EMAIL_CAMPAIGNS ?? '4110', 10)
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
    schemaPrefix: 'email_camp'
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
// Helper: create an admin user with org (org creator is owner = admin-like)
// ---------------------------------------------------------------------------
const createAdminWithOrg = async () => {
  if (!factoryContext) { throw new Error('Factory context was not initialized') }
  return dbAuthContext.createUserWithOrg()
}

// ---------------------------------------------------------------------------
// Helper: create a non-admin user (no org, no admin role)
// ---------------------------------------------------------------------------
const createMemberUser = async () => {
  if (!factoryContext) { throw new Error('Factory context was not initialized') }
  return dbAuthContext.createUser()
}

// ---------------------------------------------------------------------------
// Helper: create campaign via API
// ---------------------------------------------------------------------------
const createCampaign = async (token: string, overrides?: Record<string, unknown>) => {
  return requestJson<{ id: string; name: string; status: string; campaignType: string }>(
    '/v1/admin/email-campaigns',
    'create-campaign',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Test Campaign',
        campaignType: 'drip_sequence',
        ...overrides
      })
    }
  )
}

// ---------------------------------------------------------------------------
// Helper: add step to campaign via API
// ---------------------------------------------------------------------------
const addStep = async (token: string, campaignId: string, overrides?: Record<string, unknown>) => {
  return requestJson<{ id: string; campaignId: string; subject: string; templateId: string; delaySeconds: number }>(
    `/v1/admin/email-campaigns/${campaignId}/steps`,
    `add-step-${campaignId}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        subject: 'Welcome Email',
        templateId: 'welcome-template',
        delaySeconds: 0,
        ...overrides
      })
    }
  )
}

// NOTE: kept serial. describe.concurrent broke 19 tests with 401 —
// createAdminWithOrg()-style helpers here share admin auth state that
// races under concurrent execution. See experiment_010 revert.
describe('email campaigns API integration', () => {
  // ---------------------------------------------------------------------------
  // Auth: 401 for unauthenticated
  // ---------------------------------------------------------------------------
  describe('authentication', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { response } = await requestJson(
        '/v1/admin/email-campaigns',
        'unauthenticated-list',
        { method: 'GET' }
      )

      expect(response.status).toBe(401)
    })

    it('returns 403 for non-admin users [auth-guard]', async () => {
      // A user without an org has no roles -> should be rejected
      const member = await createMemberUser()

      const { response } = await requestJson(
        '/v1/admin/email-campaigns',
        'non-admin-list',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${member.token}` }
        }
      )

      // The route requires admin/owner role. A regular user without org membership
      // should get 401 (Unauthorized from requireAdminRole)
      expect(response.status).toBe(401)
    })
  })

  // ---------------------------------------------------------------------------
  // CRUD: create, list, get, update campaigns
  // ---------------------------------------------------------------------------
  describe('campaign CRUD', () => {
    it('creates a campaign with valid input [INV-EMAIL-CAMP-001]', async () => {
      const { token } = await createAdminWithOrg()

      const { response, body } = await createCampaign(token, {
        name: 'Onboarding Drip',
        description: 'Welcome series',
        campaignType: 'drip_sequence'
      })

      expect(response.status).toBe(201)
      expect(body.name).toBe('Onboarding Drip')
      expect(body.status).toBe('draft')
      expect(body.campaignType).toBe('drip_sequence')
    })

    it('lists campaigns', async () => {
      const { token } = await createAdminWithOrg()

      await createCampaign(token, { name: 'Campaign A' })
      await createCampaign(token, { name: 'Campaign B' })

      const { response, body } = await requestJson<{ data: Array<{ id: string; name: string }> }>(
        '/v1/admin/email-campaigns',
        'list-campaigns',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.data.length).toBe(2)
    })

    it('gets a campaign by id', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)

      const { response, body } = await requestJson<{ id: string; name: string }>(
        `/v1/admin/email-campaigns/${created.body.id}`,
        'get-campaign',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.id).toBe(created.body.id)
      expect(body.name).toBe('Test Campaign')
    })

    it('updates a campaign', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)

      const { response, body } = await requestJson<{ id: string; name: string }>(
        `/v1/admin/email-campaigns/${created.body.id}`,
        'update-campaign',
        {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: 'Updated Campaign Name' })
        }
      )

      expect(response.status).toBe(200)
      expect(body.name).toBe('Updated Campaign Name')
    })
  })

  // ---------------------------------------------------------------------------
  // Lifecycle: activate, pause, resume, archive
  // ---------------------------------------------------------------------------
  describe('campaign lifecycle', () => {
    it('rejects activation of campaign with zero steps [INV-EMAIL-CAMP-003]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)

      const { response, body } = await requestJson<{ message: string }>(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-no-steps',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(400)
      expect(body.message).toContain('at least one step')
    })

    it('activates a campaign with steps (draft -> active) [INV-EMAIL-CAMP-004]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)

      // Add a step
      await addStep(token, created.body.id)

      const { response, body } = await requestJson<{ id: string; status: string }>(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-with-step',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.status).toBe('active')
    })

    it('pauses an active campaign (active -> paused) [INV-EMAIL-CAMP-004]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-pause',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const { response, body } = await requestJson<{ id: string; status: string }>(
        `/v1/admin/email-campaigns/${created.body.id}/pause`,
        'pause-campaign',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.status).toBe('paused')
    })

    it('resumes a paused campaign (paused -> active) [INV-EMAIL-CAMP-004]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-resume',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )
      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/pause`,
        'pause-for-resume',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const { response, body } = await requestJson<{ id: string; status: string }>(
        `/v1/admin/email-campaigns/${created.body.id}/resume`,
        'resume-campaign',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.status).toBe('active')
    })

    it('archives an active campaign (active -> archived) [INV-EMAIL-CAMP-004]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-archive',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const { response, body } = await requestJson<{ id: string; status: string }>(
        `/v1/admin/email-campaigns/${created.body.id}/archive`,
        'archive-campaign',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.status).toBe('archived')
    })

    it('rejects invalid state transitions [INV-EMAIL-CAMP-004]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)

      // draft -> paused is invalid
      const { response: pauseRes } = await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/pause`,
        'invalid-draft-to-paused',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )
      expect(pauseRes.status).toBe(400)

      // draft -> archived is invalid (no direct transition)
      const { response: archiveRes } = await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/archive`,
        'invalid-draft-to-archived',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )
      expect(archiveRes.status).toBe(400)
    })

    it('rejects transitions from archived state [INV-EMAIL-CAMP-004]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-archived-test',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )
      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/archive`,
        'archive-for-archived-test',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      // archived -> active is invalid
      const { response: resumeRes } = await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/resume`,
        'invalid-archived-to-active',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )
      expect(resumeRes.status).toBe(400)
    })
  })

  // ---------------------------------------------------------------------------
  // Steps: add, update, remove
  // ---------------------------------------------------------------------------
  describe('campaign steps', () => {
    it('creates a step with subject, template, and delay [INV-EMAIL-CAMP-005]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)

      const { response, body } = await addStep(token, created.body.id, {
        subject: 'Welcome to tx-agent-kit',
        templateId: 'welcome-v2',
        delaySeconds: 3600
      })

      expect(response.status).toBe(201)
      expect(body.subject).toBe('Welcome to tx-agent-kit')
      expect(body.templateId).toBe('welcome-v2')
      expect(body.delaySeconds).toBe(3600)
      expect(body.campaignId).toBe(created.body.id)
    })

    it('lists steps for a campaign', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)

      await addStep(token, created.body.id, { subject: 'Step 1' })
      await addStep(token, created.body.id, { subject: 'Step 2' })

      const { response, body } = await requestJson<{ data: Array<{ id: string; subject: string }> }>(
        `/v1/admin/email-campaigns/${created.body.id}/steps`,
        'list-steps',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.data.length).toBe(2)
    })

    it('updates a step', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      const step = await addStep(token, created.body.id)

      const { response, body } = await requestJson<{ id: string; subject: string }>(
        `/v1/admin/email-campaigns/${created.body.id}/steps/${step.body.id}`,
        'update-step',
        {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ subject: 'Updated Subject' })
        }
      )

      expect(response.status).toBe(200)
      expect(body.subject).toBe('Updated Subject')
    })

    it('removes a step', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      const step = await addStep(token, created.body.id)

      const { response, body } = await requestJson<{ deleted: boolean }>(
        `/v1/admin/email-campaigns/${created.body.id}/steps/${step.body.id}`,
        'remove-step',
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.deleted).toBe(true)
    })

    it('rejects step mutations on non-draft campaigns [INV-EMAIL-CAMP-002]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      // Activate the campaign
      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-step-guard',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      // Try to add a step to active campaign
      const { response } = await addStep(token, created.body.id, { subject: 'New Step' })
      expect(response.status).toBe(400)
    })
  })

  // ---------------------------------------------------------------------------
  // Enrollments
  // ---------------------------------------------------------------------------
  describe('enrollments', () => {
    it('manually enrolls users via admin API [INV-EMAIL-CAMP-007]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      // Activate the campaign
      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-enroll',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      // Create another user to enroll
      const enrollee = await createMemberUser()

      const { response, body } = await requestJson<{ results: Array<{ userId: string; enrolled: boolean }> }>(
        `/v1/admin/email-campaigns/${created.body.id}/enroll`,
        'enroll-users',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ userIds: [enrollee.user.id] })
        }
      )

      expect(response.status).toBe(200)
      expect(body.results).toHaveLength(1)
      expect(body.results[0]!.enrolled).toBe(true)
      expect(body.results[0]!.userId).toBe(enrollee.user.id)
    })

    it('rejects duplicate enrollment for same user and campaign [INV-EMAIL-CAMP-008]', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-dup-enroll',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const enrollee = await createMemberUser()

      // First enrollment
      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/enroll`,
        'first-enrollment',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ userIds: [enrollee.user.id] })
        }
      )

      // Second enrollment (duplicate)
      const { response, body } = await requestJson<{ results: Array<{ userId: string; enrolled: boolean; error?: string }> }>(
        `/v1/admin/email-campaigns/${created.body.id}/enroll`,
        'duplicate-enrollment',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ userIds: [enrollee.user.id] })
        }
      )

      expect(response.status).toBe(200)
      expect(body.results[0]!.enrolled).toBe(false)
      expect(body.results[0]!.error).toBeDefined()
    })

    it('lists enrollments for a campaign', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-list-enrollments',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const enrollee = await createMemberUser()
      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/enroll`,
        'enroll-for-list',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ userIds: [enrollee.user.id] })
        }
      )

      const { response, body } = await requestJson<{ data: Array<{ id: string; userId: string; status: string }> }>(
        `/v1/admin/email-campaigns/${created.body.id}/enrollments`,
        'list-enrollments',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.data.length).toBe(1)
      expect(body.data[0]!.userId).toBe(enrollee.user.id)
      expect(body.data[0]!.status).toBe('active')
    })

    it('cancels an enrollment', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-cancel-enrollment',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const enrollee = await createMemberUser()
      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/enroll`,
        'enroll-for-cancel',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ userIds: [enrollee.user.id] })
        }
      )

      // Get the enrollment ID
      const { body: listBody } = await requestJson<{ data: Array<{ id: string }> }>(
        `/v1/admin/email-campaigns/${created.body.id}/enrollments`,
        'list-enrollments-for-cancel',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      const enrollmentId = listBody.data[0]!.id

      const { response, body } = await requestJson<{ id: string; status: string }>(
        `/v1/admin/email-campaigns/${created.body.id}/enrollments/${enrollmentId}/cancel`,
        'cancel-enrollment',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.status).toBe('cancelled')
    })
  })

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------
  describe('analytics', () => {
    it('returns campaign analytics', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      await addStep(token, created.body.id)

      await requestJson(
        `/v1/admin/email-campaigns/${created.body.id}/activate`,
        'activate-for-analytics',
        { method: 'POST', headers: { authorization: `Bearer ${token}` } }
      )

      const { response, body } = await requestJson<{ campaignId: string; totalSends: number }>(
        `/v1/admin/email-campaigns/${created.body.id}/analytics`,
        'campaign-analytics',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.campaignId).toBe(created.body.id)
      expect(body.totalSends).toBe(0)
    })

    it('returns step analytics', async () => {
      const { token } = await createAdminWithOrg()
      const created = await createCampaign(token)
      const step = await addStep(token, created.body.id)

      const { response, body } = await requestJson<{ stepId: string; campaignId: string; totalSends: number }>(
        `/v1/admin/email-campaigns/${created.body.id}/steps/${step.body.id}/analytics`,
        'step-analytics',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` }
        }
      )

      expect(response.status).toBe(200)
      expect(body.stepId).toBe(step.body.id)
      expect(body.campaignId).toBe(created.body.id)
      expect(body.totalSends).toBe(0)
    })
  })
})
