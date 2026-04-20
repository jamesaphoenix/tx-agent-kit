import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Effect, Option } from 'effect'
import {
  autoRechargeAttempts,
  creditLedger,
  creditLedgerRepository,
  db,
  domainEvents,
  getPool,
  organizations,
  organizationsRepository,
  users
} from '@tx-agent-kit/db'
import { StripePort } from '@tx-agent-kit/core'
import { createTestEmailDelivery } from '@tx-agent-kit/testkit'
import { Layer } from 'effect'
import {
  _resetBillingEmailPortForTest,
  _resetBillingStripePortForTest,
  _setBillingEmailPortForTest,
  _setBillingStripePortForTest,
  billingActivities
} from './billing-activities.js'

// @spec INV-BILLING-010 — billing outbox consumer integration tests
//
// These tests exercise the billing activity implementations directly against
// a running Postgres. The outbox workflow dispatch path is tested separately
// in the Temporal integration suite; here we care that each activity mutates
// the database in the expected way and that repeated calls are idempotent.
//
// This test intentionally does NOT start an API server or use schema
// isolation — it uses the DATABASE_URL the worker package already points at
// (typically the worktree schema) and scopes every row to a per-test
// random UUID so concurrent test runs do not collide.

const TEST_ORG_NAME_PREFIX = 'billing-outbox-test'

interface TestOrg {
  orgId: string
  userId: string
}

const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

const cleanupOrgIds: string[] = []
const cleanupUserIds: string[] = []

const pool = (): ReturnType<typeof getPool> => getPool()

const seedTestOrg = async (overrides: {
  creditsBalance?: number
  autoRechargeEnabled?: boolean
  autoRechargeAmount?: number | null
  autoRechargeThreshold?: number | null
  stripeCustomerId?: string | null
  stripePaymentMethodId?: string | null
} = {}): Promise<TestOrg> => {
  const userId = randomUUID()
  const orgId = randomUUID()

  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
      [
        userId,
        `${TEST_ORG_NAME_PREFIX}-${userId}@example.invalid`,
        'test-hash',
        `${TEST_ORG_NAME_PREFIX} user ${userId}`
      ]
    )
    await client.query(
      `INSERT INTO organizations (
         id, name, owner_user_id, credits_balance,
         auto_recharge_enabled,
         auto_recharge_amount, auto_recharge_threshold,
         stripe_customer_id, stripe_payment_method_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        orgId,
        `${TEST_ORG_NAME_PREFIX} ${orgId}`,
        userId,
        overrides.creditsBalance ?? 0,
        overrides.autoRechargeEnabled ?? (
          overrides.autoRechargeAmount !== undefined
          || overrides.autoRechargeThreshold !== undefined
        ),
        overrides.autoRechargeAmount ?? null,
        overrides.autoRechargeThreshold ?? null,
        overrides.stripeCustomerId ?? null,
        overrides.stripePaymentMethodId ?? null
      ]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  cleanupOrgIds.push(orgId)
  cleanupUserIds.push(userId)
  return { orgId, userId }
}

const seedDomainEvent = async (input: {
  eventType: string
  aggregateId: string
  payload: Record<string, unknown>
}): Promise<string> => {
  const client = await pool().connect()
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO domain_events (
         event_type, aggregate_type, aggregate_id, payload, sequence_number
       )
       VALUES ($1, 'billing', $2, $3::jsonb,
         (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM domain_events WHERE aggregate_id = $2))
       RETURNING id`,
      [input.eventType, input.aggregateId, JSON.stringify(input.payload)]
    )
    return result.rows[0]?.id ?? ''
  } finally {
    client.release()
  }
}

beforeAll(() => {
  // Force pool creation eagerly so connection errors surface in setup
  // instead of mid-test.
  pool()
  // Silence unused-import lint warnings for the schema table bindings we
  // keep around as Drizzle type anchors even though this test uses raw SQL.
  void autoRechargeAttempts
  void creditLedger
  void domainEvents
  void organizations
  void users
  void db
})

afterEach(async () => {
  _resetBillingStripePortForTest()
  if (cleanupOrgIds.length === 0 && cleanupUserIds.length === 0) {
    return
  }

  const client = await pool().connect()
  try {
    if (cleanupOrgIds.length > 0) {
      // credit_ledger + usage_records are immutable financial audit trails
      // (INV-BILLING-001/002). Deleting rows is blocked by a Postgres trigger.
      // Deleting the owning organization cascades the FKs to SET NULL so those
      // audit rows survive with organization_id = NULL — no cleanup needed.
      await client.query(
        `DELETE FROM auto_recharge_attempts WHERE organization_id = ANY($1::uuid[])`,
        [cleanupOrgIds]
      )
      await client.query(
        `DELETE FROM domain_events WHERE aggregate_id = ANY($1::uuid[])`,
        [cleanupOrgIds]
      )
      await client.query(
        `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
        [cleanupOrgIds]
      )
    }
    if (cleanupUserIds.length > 0) {
      await client.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[])`,
        [cleanupUserIds]
      )
    }
  } finally {
    client.release()
  }

  cleanupOrgIds.length = 0
  cleanupUserIds.length = 0
})

describe('billing outbox consumers (integration)', () => {
  it('billing.payment_failed → org payment grace period is ~7 days in the future', async () => {
    const { orgId } = await seedTestOrg()

    const eventId = await seedDomainEvent({
      eventType: 'billing.payment_failed',
      aggregateId: orgId,
      payload: { organizationId: orgId }
    })
    expect(eventId).not.toBe('')

    const before = Date.now()
    await billingActivities.startPaymentGracePeriod(orgId, 7)
    const after = Date.now()

    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      throw new Error(`org ${orgId} not found after payment_failed handling`)
    }
    const endsAt = org.value.paymentGracePeriodEndsAt
    expect(endsAt).toBeInstanceOf(Date)
    if (!endsAt) {
      throw new Error('expected paymentGracePeriodEndsAt to be set')
    }

    const endsAtMs = endsAt.getTime()
    const lowerBound = before + 7 * 24 * 60 * 60 * 1000 - 5000
    const upperBound = after + 7 * 24 * 60 * 60 * 1000 + 5000
    expect(endsAtMs).toBeGreaterThanOrEqual(lowerBound)
    expect(endsAtMs).toBeLessThanOrEqual(upperBound)
  })

  // @spec REQ-BILLING-009 — downstream consumer idempotency.
  it('@spec INV-BILLING-010 @spec REQ-BILLING-009 billing.payment_failed handler is idempotent on repeat calls', async () => {
    const { orgId } = await seedTestOrg()

    await billingActivities.startPaymentGracePeriod(orgId, 7)
    const firstSnapshot = await runEffect(organizationsRepository.getById(orgId))
    const firstEndsAt = Option.isSome(firstSnapshot)
      ? firstSnapshot.value.paymentGracePeriodEndsAt
      : null
    expect(firstEndsAt).not.toBeNull()

    await billingActivities.startPaymentGracePeriod(orgId, 7)
    const secondSnapshot = await runEffect(organizationsRepository.getById(orgId))
    const secondEndsAt = Option.isSome(secondSnapshot)
      ? secondSnapshot.value.paymentGracePeriodEndsAt
      : null
    expect(secondEndsAt).not.toBeNull()

    // No duplicate rows — we only mutate organizations.payment_grace_period_ends_at,
    // so repeat invocations just land very close timestamps.
    const firstMs = firstEndsAt ? firstEndsAt.getTime() : 0
    const secondMs = secondEndsAt ? secondEndsAt.getTime() : 0
    expect(Math.abs(secondMs - firstMs)).toBeLessThan(5000)
  })

  it('@spec INV-BILLING-010 billing.payment_failed reuses the webhook grace deadline when provided', async () => {
    const { orgId } = await seedTestOrg()
    const webhookDeadline = new Date('2026-04-23T12:34:56.000Z')

    await billingActivities.startPaymentGracePeriod(orgId, 7, webhookDeadline.toISOString())
    const snapshot = await runEffect(organizationsRepository.getById(orgId))
    const endsAt = Option.isSome(snapshot)
      ? snapshot.value.paymentGracePeriodEndsAt
      : null

    expect(endsAt?.toISOString()).toBe(webhookDeadline.toISOString())
  })

  it('billing.dispute_resolved (lost) writes a negative credit_ledger entry', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 1_000_000 })

    const eventId = await seedDomainEvent({
      eventType: 'billing.dispute_resolved',
      aggregateId: orgId,
      payload: {
        organizationId: orgId,
        outcome: 'lost',
        chargeAmountDecimillicents: 250_000
      }
    })
    expect(eventId).not.toBe('')

    await billingActivities.resolveCreditDispute(orgId, 'lost', 250_000)

    const entries = await runEffect(
      creditLedgerRepository.listForOrganization({ organizationId: orgId, limit: 10 })
    )
    const disputeEntries = entries.filter((e) => e.reason === 'dispute_resolution')
    expect(disputeEntries).toHaveLength(1)
    expect(disputeEntries[0]!.amountDecimillicents).toBe(-250_000)
    expect(disputeEntries[0]!.entryType).toBe('adjustment')

    // Post-state: balance debited
    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      throw new Error(`org ${orgId} not found after dispute resolution`)
    }
    expect(org.value.creditsBalance).toBe(750_000)
  })

  it.each([
    ['zero', 0],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1]
  ])('billing.dispute_resolved (lost) rejects invalid charge amounts before ledger writes (%s)', async (_label, amount) => {
    const { orgId } = await seedTestOrg({ creditsBalance: 1_000_000 })

    await expect(
      billingActivities.resolveCreditDispute(orgId, 'lost', amount)
    ).rejects.toThrow('lost dispute amount must be a positive integer <= Number.MAX_SAFE_INTEGER')

    const entries = await runEffect(
      creditLedgerRepository.listForOrganization({ organizationId: orgId, limit: 10 })
    )
    const disputeEntries = entries.filter((e) => e.reason === 'dispute_resolution')
    expect(disputeEntries).toHaveLength(0)

    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      throw new Error(`org ${orgId} not found after rejected dispute resolution`)
    }
    expect(org.value.creditsBalance).toBe(1_000_000)
  })

  // @spec billing-and-pricing-design §"Dispute Handling"
  // The freezeCreditBalance activity suspends the org on dispute_created.
  // On 'won' the suspension must be cleared — that's the whole point of
  // the won/lost branch. Historically resolveCreditDispute just logged
  // on 'won' and never called creditPositiveReevaluate, so disputes won
  // by the merchant left the org suspended indefinitely even though
  // funds were released.
  it('billing.dispute_resolved (won) clears the dispute suspension via creditPositiveReevaluate', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 1_000_000 })

    // Simulate the dispute_created freeze.
    await billingActivities.freezeCreditBalance(orgId)

    // Sanity: suspended_at is now set.
    const afterFreeze = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(afterFreeze)) {
      throw new Error(`org ${orgId} not found after freeze`)
    }
    expect(afterFreeze.value.suspendedAt).not.toBeNull()

    await billingActivities.resolveCreditDispute(orgId, 'won', 0)

    const afterWon = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(afterWon)) {
      throw new Error(`org ${orgId} not found after won`)
    }
    // Available balance is 1_000_000 − 0 = 1_000_000 > 0, so the
    // credit-positive re-evaluator should unsuspend.
    expect(afterWon.value.suspendedAt).toBeNull()
  })

  it('@spec INV-BILLING-010 @spec REQ-BILLING-009 billing.dispute_resolved (lost) handler is idempotent via reference id', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 1_000_000 })

    await billingActivities.resolveCreditDispute(orgId, 'lost', 250_000)
    await billingActivities.resolveCreditDispute(orgId, 'lost', 250_000)

    const entries = await runEffect(
      creditLedgerRepository.listForOrganization({ organizationId: orgId, limit: 10 })
    )
    const disputeEntries = entries.filter((e) => e.reason === 'dispute_resolution')
    expect(disputeEntries).toHaveLength(1)

    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      throw new Error(`org ${orgId} not found after duplicate dispute resolution`)
    }
    expect(org.value.creditsBalance).toBe(750_000)
  })

  // @spec billing-and-pricing-design
  // @spec INV-BILLING-009 — atomic ledger commit path.
  it('triggerAutoRecharge happy path: succeeded row + positive ledger + credits_recharged event', async () => {
    const { orgId } = await seedTestOrg({
      creditsBalance: 10_000,
      autoRechargeAmount: 500_000,
      autoRechargeThreshold: 50_000,
      stripeCustomerId: `cus_test_${randomUUID()}`,
      stripePaymentMethodId: `pm_test_${randomUUID()}`
    })

    await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)

    const client = await pool().connect()
    try {
      const attemptsResult = await client.query<{
        id: string
        status: string
        amount_decimillicents: string
        stripe_payment_intent_id: string | null
        completed_at: Date | null
        failure_reason: string | null
      }>(
        `SELECT id, status, amount_decimillicents, stripe_payment_intent_id, completed_at, failure_reason
         FROM auto_recharge_attempts WHERE organization_id = $1`,
        [orgId]
      )
      expect(attemptsResult.rows).toHaveLength(1)
      const attempt = attemptsResult.rows[0]!
      expect(attempt.status).toBe('succeeded')
      expect(Number(attempt.amount_decimillicents)).toBe(500_000)
      expect(attempt.stripe_payment_intent_id).toMatch(/^pi_local_/)
      expect(attempt.completed_at).not.toBeNull()
      expect(attempt.failure_reason).toBeNull()

      const ledger = await client.query<{
        amount_decimillicents: string
        entry_type: string
        reference_id: string
      }>(
        `SELECT amount_decimillicents, entry_type, reference_id
         FROM credit_ledger WHERE organization_id = $1 AND entry_type = 'auto_recharge'`,
        [orgId]
      )
      expect(ledger.rows).toHaveLength(1)
      expect(Number(ledger.rows[0]!.amount_decimillicents)).toBe(500_000)
      expect(ledger.rows[0]!.reference_id).toBe(`auto-recharge:${attempt.id}`)

      const events = await client.query<{ event_type: string; payload: Record<string, unknown> }>(
        `SELECT event_type, payload FROM domain_events
         WHERE aggregate_id = $1 AND event_type = 'billing.credits_recharged'`,
        [orgId]
      )
      expect(events.rows).toHaveLength(1)
      expect(events.rows[0]!.payload).toMatchObject({
        organizationId: orgId,
        amountDecimillicents: 500_000
      })
    } finally {
      client.release()
    }
  })

  // @spec billing-and-pricing-design
  it('triggerAutoRecharge fails with no saved payment method: attempt=failed, no ledger row, no event', async () => {
    const { orgId } = await seedTestOrg({
      creditsBalance: 10_000,
      autoRechargeAmount: 500_000,
      autoRechargeThreshold: 50_000,
      stripeCustomerId: `cus_test_${randomUUID()}`,
      stripePaymentMethodId: null
    })

    await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)

    const client = await pool().connect()
    try {
      const attemptsResult = await client.query<{
        status: string
        failure_reason: string | null
      }>(
        `SELECT status, failure_reason FROM auto_recharge_attempts WHERE organization_id = $1`,
        [orgId]
      )
      expect(attemptsResult.rows).toHaveLength(1)
      expect(attemptsResult.rows[0]!.status).toBe('failed')
      expect(attemptsResult.rows[0]!.failure_reason).toBe('no saved payment method')

      const ledger = await client.query(
        `SELECT 1 FROM credit_ledger WHERE organization_id = $1 AND entry_type = 'auto_recharge'`,
        [orgId]
      )
      expect(ledger.rows).toHaveLength(0)

      const events = await client.query(
        `SELECT 1 FROM domain_events
         WHERE aggregate_id = $1 AND event_type = 'billing.credits_recharged'`,
        [orgId]
      )
      expect(events.rows).toHaveLength(0)
    } finally {
      client.release()
    }
  })

  describe('notification delivery ownership', () => {
    let testEmail: ReturnType<typeof createTestEmailDelivery>

    beforeEach(() => {
      testEmail = createTestEmailDelivery()
      _setBillingEmailPortForTest(testEmail.port)
    })

    afterEach(() => {
      _resetBillingEmailPortForTest()
    })

    // @spec billing-and-pricing-design §"Usage Cap System"
    it('sendUsageCapWarning does not send email directly when one is configured', async () => {
      const billingEmail = `billing-${randomUUID()}@example.invalid`
      const { orgId } = await seedTestOrg()
      // Inject a billing email after seeding (factory does not surface it).
      const client = await pool().connect()
      try {
        await client.query(
          `UPDATE organizations SET billing_email = $1 WHERE id = $2`,
          [billingEmail, orgId]
        )
      } finally {
        client.release()
      }

      await billingActivities.sendUsageCapWarning(orgId, 90, 100_000_000)

      expect(testEmail.sends).toHaveLength(0)
    })

    // @spec billing-and-pricing-design §"Usage Cap System"
    it('sendUsageCapWarning is a no-op when the org has no billing email', async () => {
      const { orgId } = await seedTestOrg()
      // billing_email defaults to null on insert.

      await billingActivities.sendUsageCapWarning(orgId, 75, 100_000_000)

      expect(testEmail.sends).toHaveLength(0)
    })

    // @spec billing-and-pricing-design §"Payment Grace Period"
    it('startPaymentGracePeriod sets the timestamp without direct email delivery', async () => {
      const billingEmail = `billing-${randomUUID()}@example.invalid`
      const { orgId } = await seedTestOrg()
      const client = await pool().connect()
      try {
        await client.query(
          `UPDATE organizations SET billing_email = $1 WHERE id = $2`,
          [billingEmail, orgId]
        )
      } finally {
        client.release()
      }

      await billingActivities.startPaymentGracePeriod(orgId, 7)

      // Org timestamp is set
      const org = await runEffect(organizationsRepository.getById(orgId))
      if (Option.isNone(org)) {
        throw new Error(`org ${orgId} not found`)
      }
      expect(org.value.paymentGracePeriodEndsAt).toBeInstanceOf(Date)

      // Email delivery is centralized in notifyBillingEvent to prevent
      // duplicate sends when the workflow fans out the same billing event.
      expect(testEmail.sends).toHaveLength(0)
    })

    // @spec billing-and-pricing-design §"Payment Grace Period"
    it('startPaymentGracePeriod still flips the grace timestamp when no billing email is set', async () => {
      const { orgId } = await seedTestOrg()

      await billingActivities.startPaymentGracePeriod(orgId, 7)

      const org = await runEffect(organizationsRepository.getById(orgId))
      if (Option.isNone(org)) {
        throw new Error(`org ${orgId} not found`)
      }
      expect(org.value.paymentGracePeriodEndsAt).toBeInstanceOf(Date)
      expect(testEmail.sends).toHaveLength(0)
    })
  })

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it('applyUsageCapExceeded sets organizations.suspended_at to a fresh timestamp', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 0 })

    const before = Date.now()
    await billingActivities.applyUsageCapExceeded(orgId, 100_000_000)
    const after = Date.now()

    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      throw new Error(`org ${orgId} not found after usage cap exceeded`)
    }
    const suspendedAt = org.value.suspendedAt
    expect(suspendedAt).toBeInstanceOf(Date)
    if (!suspendedAt) {
      throw new Error('expected suspendedAt to be set')
    }
    expect(suspendedAt.getTime()).toBeGreaterThanOrEqual(before - 5000)
    expect(suspendedAt.getTime()).toBeLessThanOrEqual(after + 5000)
  })

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  // @spec INV-BILLING-010 — billing event consumers are idempotent.
  it('applyUsageCapExceeded is idempotent — second call preserves the original suspension instant', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 0 })

    await billingActivities.applyUsageCapExceeded(orgId, 100_000_000)
    const first = await runEffect(organizationsRepository.getById(orgId))
    const firstSuspendedAt = Option.isSome(first) ? first.value.suspendedAt : null
    expect(firstSuspendedAt).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 50))
    await billingActivities.applyUsageCapExceeded(orgId, 100_000_000)
    const second = await runEffect(organizationsRepository.getById(orgId))
    const secondSuspendedAt = Option.isSome(second) ? second.value.suspendedAt : null
    expect(secondSuspendedAt).not.toBeNull()
    expect(secondSuspendedAt!.getTime()).toBe(firstSuspendedAt!.getTime())
  })

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it('creditPositiveReevaluate clears suspended_at when balance is positive', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 0 })

    // First suspend the org
    await billingActivities.applyUsageCapExceeded(orgId, 100_000_000)
    const beforeReeval = await runEffect(organizationsRepository.getById(orgId))
    expect(Option.isSome(beforeReeval) && beforeReeval.value.suspendedAt !== null).toBe(true)

    // Top up the balance via a positive ledger entry
    await runEffect(
      creditLedgerRepository.append({
        organizationId: orgId,
        entryType: 'purchase',
        amountDecimillicents: 1_000_000,
        reason: 'integration-test top up',
        referenceId: `topup:${randomUUID()}`
      })
    )

    // Now re-evaluate
    await billingActivities.creditPositiveReevaluate(orgId)

    const afterReeval = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(afterReeval)) {
      throw new Error(`org ${orgId} not found after credit positive reevaluate`)
    }
    expect(afterReeval.value.suspendedAt).toBeNull()
    expect(afterReeval.value.creditsBalance).toBe(1_000_000)
  })

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it('creditPositiveReevaluate is a no-op when balance is still <= 0', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 0 })
    await billingActivities.applyUsageCapExceeded(orgId, 100_000_000)

    // No top-up — balance is still 0
    await billingActivities.creditPositiveReevaluate(orgId)

    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      throw new Error(`org ${orgId} not found`)
    }
    expect(org.value.suspendedAt).not.toBeNull()
  })

  // @spec billing-and-pricing-design §"Dispute Handling"
  it('freezeCreditBalance sets suspended_at on dispute_created', async () => {
    const { orgId } = await seedTestOrg({ creditsBalance: 1_000_000 })

    await billingActivities.freezeCreditBalance(orgId)

    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      throw new Error(`org ${orgId} not found after freeze`)
    }
    expect(org.value.suspendedAt).toBeInstanceOf(Date)
  })

  // @spec INV-BILLING-010 @spec REQ-BILLING-009
  it('@spec INV-BILLING-010 triggerAutoRecharge is idempotent: one attempt and one ledger row on double call', async () => {
    const { orgId } = await seedTestOrg({
      creditsBalance: 10_000,
      autoRechargeAmount: 500_000,
      autoRechargeThreshold: 50_000,
      stripeCustomerId: `cus_test_${randomUUID()}`,
      stripePaymentMethodId: `pm_test_${randomUUID()}`
    })

    await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)
    await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)

    const client = await pool().connect()
    try {
      const attempts = await client.query(
        `SELECT 1 FROM auto_recharge_attempts WHERE organization_id = $1`,
        [orgId]
      )
      expect(attempts.rows).toHaveLength(1)

      const ledger = await client.query(
        `SELECT 1 FROM credit_ledger WHERE organization_id = $1 AND entry_type = 'auto_recharge'`,
        [orgId]
      )
      expect(ledger.rows).toHaveLength(1)
    } finally {
      client.release()
    }
  })

  it('triggerAutoRecharge does not charge when autoRechargeEnabled is false', async () => {
    const { orgId } = await seedTestOrg({
      creditsBalance: 10_000,
      autoRechargeEnabled: false,
      autoRechargeAmount: 500_000,
      autoRechargeThreshold: 50_000,
      stripeCustomerId: `cus_test_${randomUUID()}`,
      stripePaymentMethodId: `pm_test_${randomUUID()}`
    })

    await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)

    const client = await pool().connect()
    try {
      const attempts = await client.query<{ status: string; failure_reason: string | null }>(
        `SELECT status, failure_reason
           FROM auto_recharge_attempts
          WHERE organization_id = $1`,
        [orgId]
      )
      expect(attempts.rows).toHaveLength(0)

      const ledger = await client.query(
        `SELECT 1 FROM credit_ledger WHERE organization_id = $1 AND entry_type = 'auto_recharge'`,
        [orgId]
      )
      expect(ledger.rows).toHaveLength(0)
    } finally {
      client.release()
    }
  })

  // @spec INV-BILLING-010 — idempotency must hold under parallel invocations,
  // not just sequential ones. Two concurrent `credits_low_balance` events for
  // the same org must collapse to a single Stripe charge + single ledger row.
  // The sequential idempotency test relies on the threshold-guard short-circuit
  // (after the first call commits, the second call sees a refilled balance);
  // that guard cannot save us when both calls race past the check-then-insert
  // on auto_recharge_attempts before either commits.
  it('@spec INV-BILLING-010 triggerAutoRecharge is idempotent under parallel invocation', async () => {
    let stripeChargeCalls = 0
    _setBillingStripePortForTest(() =>
      Layer.succeed(StripePort, {
        createCheckoutSession: () => Effect.fail(new Error('not used in test')),
        createPortalSession: () => Effect.fail(new Error('not used in test')),
        createTopUpSession: () => Effect.fail(new Error('not used in test')),
        constructWebhookEvent: () => Effect.fail(new Error('not used in test')),
        createCustomer: () => Effect.fail(new Error('not used in test')),
        createOffSessionPaymentIntent: () =>
          Effect.promise(async () => {
            stripeChargeCalls += 1
            await new Promise((resolve) => setTimeout(resolve, 25))
            return {
              id: `pi_parallel_${randomUUID()}`,
              status: 'succeeded' as const,
              amountCharged: 500_000,
              clientSecret: null
            }
          }),
        resolvePlanFromPriceIds: () => 'pro' as const
      })
    )
    const { orgId } = await seedTestOrg({
      creditsBalance: 10_000,
      autoRechargeAmount: 500_000,
      autoRechargeThreshold: 50_000,
      stripeCustomerId: `cus_test_${randomUUID()}`,
      stripePaymentMethodId: `pm_test_${randomUUID()}`
    })

    // Fire both invocations concurrently. JS single-threading will serialize
    // until the first `await` — then the two fibers interleave on every DB
    // query, reproducing the check-then-insert race path.
    await Promise.all([
      billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000),
      billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)
    ])

    const client = await pool().connect()
    try {
      const attempts = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM auto_recharge_attempts WHERE organization_id = $1`,
        [orgId]
      )
      // Exactly one attempt row — no duplicate pending siblings.
      expect(attempts.rows).toHaveLength(1)
      expect(attempts.rows[0]?.status).toBe('succeeded')

      const ledger = await client.query<{ amount_decimillicents: string }>(
        `SELECT amount_decimillicents FROM credit_ledger
          WHERE organization_id = $1 AND entry_type = 'auto_recharge'`,
        [orgId]
      )
      // Exactly one ledger row — not a double-credit.
      expect(ledger.rows).toHaveLength(1)
      expect(Number(ledger.rows[0]?.amount_decimillicents)).toBe(500_000)

      const orgRow = await client.query<{ credits_balance: string }>(
        'SELECT credits_balance FROM organizations WHERE id = $1',
        [orgId]
      )
      // Seeded 10_000 + one recharge 500_000 = 510_000 — not 1_010_000.
      expect(Number(orgRow.rows[0]?.credits_balance)).toBe(510_000)

      const events = await client.query(
        `SELECT 1 FROM domain_events
          WHERE aggregate_id = $1 AND event_type = 'billing.credits_recharged'`,
        [orgId]
      )
      expect(events.rows).toHaveLength(1)
      expect(stripeChargeCalls).toBe(1)
    } finally {
      client.release()
    }
  })

  describe('3DS off-session challenge flow', () => {
    afterEach(() => {
      _resetBillingStripePortForTest()
    })

    // @spec billing-and-pricing-design §"3DS off-session challenge"
    // @spec INV-BILLING-009 — atomic event commit pattern
    it('triggerAutoRecharge requires_action: emits billing.recharge_requires_action with client_secret', async () => {
      const { orgId } = await seedTestOrg({
        creditsBalance: 10_000,
        autoRechargeAmount: 500_000,
        autoRechargeThreshold: 50_000,
        stripeCustomerId: `cus_test_${randomUUID()}`,
        stripePaymentMethodId: `pm_test_${randomUUID()}`
      })

      // Inject a Stripe stub that always returns requires_action with a
      // synthetic client_secret. This is exactly what the live SDK
      // returns when an off-session card needs 3DS.
      const stubIntentId = `pi_test_${randomUUID()}`
      const stubClientSecret = `${stubIntentId}_secret_${randomUUID()}`
      _setBillingStripePortForTest(() =>
        Layer.succeed(StripePort, {
          createCheckoutSession: () => Effect.fail(new Error('not used in test')),
          createPortalSession: () => Effect.fail(new Error('not used in test')),
          createTopUpSession: () => Effect.fail(new Error('not used in test')),
          constructWebhookEvent: () => Effect.fail(new Error('not used in test')),
          createCustomer: () => Effect.fail(new Error('not used in test')),
          createOffSessionPaymentIntent: () =>
            Effect.succeed({
              id: stubIntentId,
              status: 'requires_action' as const,
              amountCharged: 0,
              clientSecret: stubClientSecret
            }),
          resolvePlanFromPriceIds: () => 'pro' as const
        })
      )

      await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)

      // Verify attempt row is failed with 'requires user action'
      const attemptResult = await runEffect(
        creditLedgerRepository.listForOrganization({ organizationId: orgId, limit: 0 })
      )
      void attemptResult // silence unused-var
      const client = await pool().connect()
      try {
        const attempts = await client.query<{
          id: string
          status: string
          stripe_payment_intent_id: string | null
          failure_reason: string | null
        }>(
          `SELECT id, status, stripe_payment_intent_id, failure_reason
             FROM auto_recharge_attempts
            WHERE organization_id = $1`,
          [orgId]
        )
        expect(attempts.rows).toHaveLength(1)
        const attempt = attempts.rows[0]!
        expect(attempt.status).toBe('failed')
        expect(attempt.failure_reason).toBe('requires user action')
        expect(attempt.stripe_payment_intent_id).toBe(stubIntentId)

        // Verify the outbox event landed in the same transaction —
        // payload must include the stripe_payment_intent_id, attempt_id,
        // and client_secret.
        const events = await client.query<{
          event_type: string
          payload: Record<string, unknown>
        }>(
          `SELECT event_type, payload FROM domain_events
            WHERE aggregate_id = $1 AND event_type = 'billing.recharge_requires_action'`,
          [orgId]
        )
        expect(events.rows).toHaveLength(1)
        const payload = events.rows[0]!.payload
        expect(payload).toMatchObject({
          organizationId: orgId,
          attemptId: attempt.id,
          amountDecimillicents: 500_000,
          stripePaymentIntentId: stubIntentId,
          clientSecret: stubClientSecret
        })

        // No credit_ledger row should be appended on the requires_action
        // path — credits are only granted on a successful PaymentIntent.
        const ledger = await client.query(
          `SELECT 1 FROM credit_ledger WHERE organization_id = $1 AND entry_type = 'auto_recharge'`,
          [orgId]
        )
        expect(ledger.rows).toHaveLength(0)
      } finally {
        client.release()
      }
    })

    // @spec billing-and-pricing-design §"3DS off-session challenge"
    // @spec INV-BILLING-010 — billing consumers are idempotent
    it('triggerAutoRecharge requires_action is idempotent — second call reuses the unresolved challenge', async () => {
      const { orgId } = await seedTestOrg({
        creditsBalance: 10_000,
        autoRechargeAmount: 500_000,
        autoRechargeThreshold: 50_000,
        stripeCustomerId: `cus_test_${randomUUID()}`,
        stripePaymentMethodId: `pm_test_${randomUUID()}`
      })

      const stubIntentId = `pi_test_${randomUUID()}`
      const stubClientSecret = `${stubIntentId}_secret_${randomUUID()}`
      let stripeChargeCalls = 0
      _setBillingStripePortForTest(() =>
        Layer.succeed(StripePort, {
          createCheckoutSession: () => Effect.fail(new Error('not used in test')),
          createPortalSession: () => Effect.fail(new Error('not used in test')),
          createTopUpSession: () => Effect.fail(new Error('not used in test')),
          constructWebhookEvent: () => Effect.fail(new Error('not used in test')),
          createCustomer: () => Effect.fail(new Error('not used in test')),
          createOffSessionPaymentIntent: () =>
            Effect.sync(() => {
              stripeChargeCalls += 1
              return {
              id: stubIntentId,
              status: 'requires_action' as const,
              amountCharged: 0,
              clientSecret: stubClientSecret
              }
            }),
          resolvePlanFromPriceIds: () => 'pro' as const
        })
      )

      await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)
      await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)

      const client = await pool().connect()
      try {
        const events = await client.query(
          `SELECT 1 FROM domain_events
            WHERE aggregate_id = $1 AND event_type = 'billing.recharge_requires_action'`,
          [orgId]
        )
        const attempts = await client.query<{ id: string }>(
          `SELECT id FROM auto_recharge_attempts WHERE organization_id = $1`,
          [orgId]
        )
        expect(attempts.rows).toHaveLength(1)
        expect(events.rows).toHaveLength(1)
        expect(stripeChargeCalls).toBe(1)
      } finally {
        client.release()
      }
    })
  })

  describe('auto-recharge T+48h retry policy', () => {
    // @spec billing-and-pricing-design §"Auto-recharge retry policy"
    it('triggerAutoRecharge schedules a retry at ~T+48h on first failure', async () => {
      const { orgId } = await seedTestOrg({
        creditsBalance: 10_000,
        autoRechargeAmount: 500_000,
        autoRechargeThreshold: 50_000,
        stripeCustomerId: `cus_test_${randomUUID()}`,
        // No payment method → first attempt fails as 'no saved payment method'
        stripePaymentMethodId: null
      })

      const before = Date.now()
      await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)
      const after = Date.now()

      const client = await pool().connect()
      try {
        const result = await client.query<{
          id: string
          status: string
          next_retry_at: Date | null
          retried_from_attempt_id: string | null
          failure_reason: string | null
        }>(
          `SELECT id, status, next_retry_at, retried_from_attempt_id, failure_reason
             FROM auto_recharge_attempts
            WHERE organization_id = $1`,
          [orgId]
        )
        expect(result.rows).toHaveLength(1)
        const attempt = result.rows[0]!
        expect(attempt.status).toBe('failed')
        expect(attempt.failure_reason).toBe('no saved payment method')
        expect(attempt.retried_from_attempt_id).toBeNull()
        expect(attempt.next_retry_at).toBeInstanceOf(Date)
        if (attempt.next_retry_at) {
          const expected = before + 48 * 60 * 60 * 1000
          const upper = after + 48 * 60 * 60 * 1000
          expect(attempt.next_retry_at.getTime()).toBeGreaterThanOrEqual(expected - 5000)
          expect(attempt.next_retry_at.getTime()).toBeLessThanOrEqual(upper + 5000)
        }
      } finally {
        client.release()
      }
    })

    // @spec billing-and-pricing-design §"Auto-recharge retry policy"
    // A transient Stripe/network exception must not leave a permanent
    // `pending` attempt. The retry scheduler is the recovery path; Stripe
    // idempotency on the attempt id makes re-firing safe even if the first
    // request reached Stripe but the worker never received the response.
    it('triggerAutoRecharge schedules a retry when the Stripe charge throws unexpectedly', async () => {
      _setBillingStripePortForTest(() =>
        Layer.succeed(StripePort, {
          createCheckoutSession: () => Effect.fail(new Error('not used in test')),
          createPortalSession: () => Effect.fail(new Error('not used in test')),
          createTopUpSession: () => Effect.fail(new Error('not used in test')),
          constructWebhookEvent: () => Effect.fail(new Error('not used in test')),
          createCustomer: () => Effect.fail(new Error('not used in test')),
          createOffSessionPaymentIntent: () => Effect.fail(new Error('stripe timeout')),
          resolvePlanFromPriceIds: () => 'pro' as const
        })
      )

      const { orgId } = await seedTestOrg({
        creditsBalance: 10_000,
        autoRechargeAmount: 500_000,
        autoRechargeThreshold: 50_000,
        stripeCustomerId: `cus_test_${randomUUID()}`,
        stripePaymentMethodId: `pm_test_${randomUUID()}`
      })

      await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)

      const client = await pool().connect()
      try {
        const result = await client.query<{
          status: string
          failure_reason: string | null
          next_retry_at: Date | null
        }>(
          `SELECT status, failure_reason, next_retry_at
             FROM auto_recharge_attempts
            WHERE organization_id = $1`,
          [orgId]
        )
        expect(result.rows).toHaveLength(1)
        const attempt = result.rows[0]!
        expect(attempt.status).toBe('failed')
        expect(attempt.failure_reason).toContain('Failed to create off-session PaymentIntent')
        expect(attempt.next_retry_at).toBeInstanceOf(Date)
      } finally {
        client.release()
      }
    })

    // @spec billing-and-pricing-design §"Auto-recharge retry policy"
    // @spec INV-BILLING-010 — billing consumers are idempotent.
    it('processDueAutoRechargeRetries fires the retry and on second failure marks permanent_failed', async () => {
      const { orgId } = await seedTestOrg({
        creditsBalance: 10_000,
        autoRechargeAmount: 500_000,
        autoRechargeThreshold: 50_000,
        stripeCustomerId: `cus_test_${randomUUID()}`,
        stripePaymentMethodId: null
      })

      // First trigger fails → schedules a retry
      await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)

      // Manually backdate next_retry_at so the scan picks it up immediately.
      const sqlClient = await pool().connect()
      try {
        await sqlClient.query(
          `UPDATE auto_recharge_attempts
              SET next_retry_at = now() - INTERVAL '1 minute'
            WHERE organization_id = $1`,
          [orgId]
        )
      } finally {
        sqlClient.release()
      }

      const retried = await billingActivities.processDueAutoRechargeRetries()
      expect(retried).toBe(1)

      // The retry attempt also fails (still no payment method) → permanent_failed.
      const checkClient = await pool().connect()
      try {
        const rows = await checkClient.query<{
          id: string
          status: string
          retried_from_attempt_id: string | null
          next_retry_at: Date | null
        }>(
          `SELECT id, status, retried_from_attempt_id, next_retry_at
             FROM auto_recharge_attempts
            WHERE organization_id = $1
            ORDER BY created_at`,
          [orgId]
        )
        expect(rows.rows).toHaveLength(2)

        const original = rows.rows[0]!
        const retry = rows.rows[1]!
        expect(original.retried_from_attempt_id).toBeNull()
        // The original row's nextRetryAt was cleared by the scheduler.
        expect(original.next_retry_at).toBeNull()

        expect(retry.retried_from_attempt_id).toBe(original.id)
        expect(retry.status).toBe('permanent_failed')
      } finally {
        checkClient.release()
      }
    })

    // @spec billing-and-pricing-design §"Auto-recharge retry policy"
    it('processDueAutoRechargeRetries is a no-op when no rows are due', async () => {
      const { orgId } = await seedTestOrg({
        creditsBalance: 0,
        autoRechargeAmount: 500_000,
        autoRechargeThreshold: 50_000,
        stripeCustomerId: `cus_test_${randomUUID()}`,
        stripePaymentMethodId: null
      })
      // First failure schedules a retry 48 h in the future
      await billingActivities.triggerAutoRecharge(orgId, 0, 50_000)

      const retried = await billingActivities.processDueAutoRechargeRetries()
      expect(retried).toBe(0)
    })

    // @spec billing-and-pricing-design §"Auto-recharge retry policy"
    it('processDueAutoRechargeRetries is concurrency-safe: parallel runs collapse to one retry', async () => {
      const { orgId } = await seedTestOrg({
        creditsBalance: 10_000,
        autoRechargeAmount: 500_000,
        autoRechargeThreshold: 50_000,
        stripeCustomerId: `cus_test_${randomUUID()}`,
        stripePaymentMethodId: null
      })
      await billingActivities.triggerAutoRecharge(orgId, 10_000, 50_000)

      const sqlClient = await pool().connect()
      try {
        await sqlClient.query(
          `UPDATE auto_recharge_attempts
              SET next_retry_at = now() - INTERVAL '1 minute'
            WHERE organization_id = $1`,
          [orgId]
        )
      } finally {
        sqlClient.release()
      }

      const [a, b] = await Promise.all([
        billingActivities.processDueAutoRechargeRetries(),
        billingActivities.processDueAutoRechargeRetries()
      ])
      // Exactly one retry runs, regardless of which side won the race.
      expect(a + b).toBe(1)

      const checkClient = await pool().connect()
      try {
        const rows = await checkClient.query<{ id: string }>(
          `SELECT id FROM auto_recharge_attempts WHERE organization_id = $1`,
          [orgId]
        )
        // 1 original + 1 retry. NOT 1 original + 2 retries.
        expect(rows.rows).toHaveLength(2)
      } finally {
        checkClient.release()
      }
    })
  })
})
