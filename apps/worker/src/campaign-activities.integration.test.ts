import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  campaignRepository,
  campaignStepRepository,
  emailSendRepository,
  enrollmentRepository,
  getPool
} from '@tx-agent-kit/db'
import type { SerializedDomainEvent } from './activities.js'
import { campaignActivities } from './campaign-activities.js'

// End-to-end coverage of the drip SWEEP path against a running Postgres:
//   lifecycle event -> enrollMatchingCampaigns (inline enroll)
//     -> sweepDueEnrollments (claim + pure reducer + render/send + advance)
//
// This is the keystone the per-enrollment workflow was replaced by: the
// enrollment row is the only state, and the sweep is the single mover. It runs
// directly against the worker package's DATABASE_URL (the worktree schema, like
// billing-activities.integration.test.ts) and scopes every row to a per-test
// random UUID, so concurrent runs in other worktrees/slots do not collide.
//
// Email transport is test-mode: RESEND_API_KEY is unset in dev, so
// renderAndSendEmail upserts exactly one (enrollment, step) send row and logs
// instead of delivering (NODE_ENV=development -> warn, not throw). The send row's
// existence + the enrollment advancing are what prove the sweep ran the full
// claim -> reduce -> send -> advance loop.

const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

const pool = (): ReturnType<typeof getPool> => getPool()

const cleanupCampaignIds: string[] = []
const cleanupUserIds: string[] = []

const seedUser = async (): Promise<{ userId: string; email: string }> => {
  const userId = randomUUID()
  const email = `drip-sweep-${userId}@example.invalid`
  const client = await pool().connect()
  try {
    await client.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
      [userId, email, 'test-hash', `Drip Sweep User ${userId}`]
    )
  } finally {
    client.release()
  }
  cleanupUserIds.push(userId)
  return { userId, email }
}

interface SeedCampaignOptions {
  /**
   * Step delays in seconds, one entry per step (step_order 1..N). A leading 0
   * makes step 1 due immediately so the first sweep sends it.
   */
  readonly stepDelaysSeconds: ReadonlyArray<number>
}

const seedDripCampaign = async (options: SeedCampaignOptions): Promise<string> => {
  const campaign = await runEffect(
    campaignRepository.create({
      name: `Drip Sweep ${randomUUID()}`,
      campaignType: 'drip_sequence',
      status: 'active',
      triggerConfig: { type: 'domain_event', eventType: 'lifecycle.signed_up' },
      slug: `drip-sweep-${randomUUID()}`
    })
  )
  if (campaign === null) {
    throw new Error('Failed to seed drip campaign')
  }
  cleanupCampaignIds.push(campaign.id)

  let stepOrder = 1
  for (const delaySeconds of options.stepDelaysSeconds) {
    await runEffect(
      campaignStepRepository.create({
        campaignId: campaign.id,
        stepOrder,
        subject: `Welcome (step ${stepOrder})`,
        templateId: 'lifecycle/welcome',
        delaySeconds
      })
    )
    stepOrder += 1
  }

  return campaign.id
}

const signedUpEvent = (userId: string): SerializedDomainEvent => ({
  id: randomUUID(),
  eventType: 'lifecycle.signed_up',
  aggregateType: 'lifecycle',
  aggregateId: userId,
  payload: { userId },
  correlationId: null,
  sequenceNumber: 1,
  status: 'processing',
  occurredAt: new Date().toISOString(),
  processingAt: null,
  publishedAt: null,
  failedAt: null,
  failureReason: null,
  createdAt: new Date().toISOString()
})

const countSendsForEnrollmentStep = async (enrollmentId: string, stepId: string): Promise<number> => {
  const client = await pool().connect()
  try {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::int AS count FROM email_sends WHERE enrollment_id = $1 AND step_id = $2',
      [enrollmentId, stepId]
    )
    return Number(result.rows[0]?.count ?? 0)
  } finally {
    client.release()
  }
}

beforeAll(() => {
  // Force pool creation eagerly so connection errors surface in setup
  // instead of mid-test.
  pool()
})

afterEach(async () => {
  if (cleanupCampaignIds.length === 0 && cleanupUserIds.length === 0) {
    return
  }
  const client = await pool().connect()
  try {
    if (cleanupCampaignIds.length > 0) {
      // Deleting the campaign cascades its steps, enrollments, and email_sends.
      await client.query('DELETE FROM email_campaigns WHERE id = ANY($1::uuid[])', [cleanupCampaignIds])
    }
    if (cleanupUserIds.length > 0) {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [cleanupUserIds])
    }
  } finally {
    client.release()
  }
  cleanupCampaignIds.length = 0
  cleanupUserIds.length = 0
})

describe('drip sweep end-to-end (enroll -> sweep -> send -> advance)', () => {
  it('enrolls, then a single sweep sends step 1 and completes the one-step enrollment', async () => {
    const { userId } = await seedUser()
    const campaignId = await seedDripCampaign({ stepDelaysSeconds: [0] })
    const steps = await runEffect(campaignStepRepository.findByCampaign(campaignId))
    const stepId = steps[0]?.id ?? ''
    expect(stepId).not.toBe('')

    // (b) Inline enroll: next_step_at stamped (step 1 delay 0 => due now), and
    // current_step_order NULL (no step delivered yet).
    await campaignActivities.enrollMatchingCampaigns(signedUpEvent(userId))

    const enrolled = await runEffect(enrollmentRepository.findByCampaignAndUser(campaignId, userId))
    expect(enrolled).not.toBeNull()
    expect(enrolled?.status).toBe('active')
    expect(enrolled?.nextStepAt).not.toBeNull()
    expect(enrolled?.currentStepOrder).toBeNull()
    const enrollmentId = enrolled?.id ?? ''
    expect(enrollmentId).not.toBe('')

    // (c) Run the real sweep: claim + reduce + send + advance.
    const result = await campaignActivities.sweepDueEnrollments(50)
    expect(result.claimed).toBeGreaterThanOrEqual(1)
    expect(result.sent).toBeGreaterThanOrEqual(1)
    expect(result.completed).toBeGreaterThanOrEqual(1)

    // Exactly one email_sends row for this (enrollment, step). Transport is
    // test-mode (no Resend key), so the row exists as proof the send path ran.
    expect(await countSendsForEnrollmentStep(enrollmentId, stepId)).toBe(1)
    const send = await runEffect(emailSendRepository.findByEnrollmentAndStep(enrollmentId, stepId))
    expect(send).not.toBeNull()
    expect(send?.campaignId).toBe(campaignId)
    expect(send?.userId).toBe(userId)

    // Sending the only step is the last step: the enrollment is completed (the
    // due-queue index excludes next_step_at IS NULL, so it can never be re-claimed).
    const completed = await runEffect(enrollmentRepository.findById(enrollmentId))
    expect(completed?.status).toBe('completed')
    expect(completed?.nextStepAt).toBeNull()
    expect(completed?.completedAt).not.toBeNull()
  })

  it('is idempotent: a second sweep before the next step is due writes no second send row', async () => {
    const { userId } = await seedUser()
    // Two steps: step 1 due now (delay 0), step 2 far in the future (delay 1h) so
    // the enrollment advances (not completes) and the second sweep finds it not due.
    const campaignId = await seedDripCampaign({ stepDelaysSeconds: [0, 3600] })
    const steps = await runEffect(campaignStepRepository.findByCampaign(campaignId))
    const step1Id = steps[0]?.id ?? ''
    expect(step1Id).not.toBe('')

    await campaignActivities.enrollMatchingCampaigns(signedUpEvent(userId))
    const enrolled = await runEffect(enrollmentRepository.findByCampaignAndUser(campaignId, userId))
    const enrollmentId = enrolled?.id ?? ''
    expect(enrollmentId).not.toBe('')

    // First sweep: send step 1, then ADVANCE to step 2 (not complete) since a
    // later step remains.
    const first = await campaignActivities.sweepDueEnrollments(50)
    expect(first.sent).toBeGreaterThanOrEqual(1)

    expect(await countSendsForEnrollmentStep(enrollmentId, step1Id)).toBe(1)
    const advanced = await runEffect(enrollmentRepository.findById(enrollmentId))
    expect(advanced?.status).toBe('active')
    expect(advanced?.currentStepOrder).toBe(1)
    expect(advanced?.nextStepAt).not.toBeNull()
    // Step 2 is ~1h out, so the row is no longer due.
    expect((advanced?.nextStepAt as Date).getTime()).toBeGreaterThan(Date.now())

    // (d) Second sweep before step 2 is due: nothing claimable for this row, so
    // no second send row and the enrollment is unchanged.
    const second = await campaignActivities.sweepDueEnrollments(50)

    expect(await countSendsForEnrollmentStep(enrollmentId, step1Id)).toBe(1)
    const unchanged = await runEffect(enrollmentRepository.findById(enrollmentId))
    expect(unchanged?.status).toBe('active')
    expect(unchanged?.currentStepOrder).toBe(1)
    // Sanity: the second sweep did not re-send to this enrollment's step 1.
    expect(second.sent).toBeGreaterThanOrEqual(0)
  })
})
