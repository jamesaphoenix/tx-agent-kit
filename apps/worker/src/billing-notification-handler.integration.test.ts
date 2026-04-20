/**
 * Integration test for the Slice 6 billing notification fan-out activity.
 *
 * Seeds an org + owner, then invokes the `notifyBillingEvent` activity
 * directly (bypassing Temporal) for a `billing.welcome_credit_granted`
 * event. Asserts:
 *   1. A notifications row exists for the org owner.
 *   2. metadata.outbox_event_id matches the synthetic event id.
 *   3. Calling the activity twice with the same event id produces
 *      exactly one notification row (INV-NOTIF-002).
 *   4. When the injected EmailDeliveryPort fails, the in-app notification
 *      is STILL created (INV-NOTIF-005).
 *
 * @spec notifications-design §"Minimal-First Implementation Plan"
 * @spec INV-NOTIF-002 — dispatch is idempotent per outbox event id
 * @spec INV-NOTIF-005 — email failures must not block in-app creation
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPool, organizations, users } from '@tx-agent-kit/db'
import { EmailDeliveryError } from '@tx-agent-kit/email'
import {
  buildSerializedDomainEvent,
  cleanupBillingOrganizations,
  createTestEmailDelivery,
  expectNotificationForOutboxEventWithClient,
  seedBillingOrganization
} from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import {
  _resetBillingEmailPortForTest,
  _setBillingEmailPortForTest,
  billingActivities
} from './billing-activities.js'
import { resetWorkerEnvCache } from './config/env.js'
import type { SerializedDomainEvent } from './activities.js'

const TEST_PREFIX = 'billing-notification-handler-test'

const cleanupOrgIds: string[] = []
const cleanupUserIds: string[] = []

const pool = (): ReturnType<typeof getPool> => getPool()

const seedOrg = async (): Promise<{ orgId: string; userId: string }> => {
  const { orgId, userId } = await seedBillingOrganization(pool(), {
    prefix: TEST_PREFIX,
    subscriptionPlan: 'pro',
    isSubscribed: true,
    subscriptionStatus: 'active'
  })
  cleanupOrgIds.push(orgId)
  cleanupUserIds.push(userId)
  return { orgId, userId }
}

const makeWelcomeEvent = (orgId: string, eventId: string): SerializedDomainEvent =>
  buildSerializedDomainEvent({
    eventId,
    eventType: 'billing.welcome_credit_granted',
    aggregateId: orgId,
    payload: {
      organizationId: orgId,
      amountDecimillicents: 20_000_000, // $20
      plan: 'pro',
      stripeEventId: `evt_${eventId}`
    }
  })

const makeRefundEvent = (orgId: string, eventId: string): SerializedDomainEvent =>
  buildSerializedDomainEvent({
    eventId,
    eventType: 'billing.credits_refunded',
    aggregateId: orgId,
    payload: {
      organizationId: orgId,
      amountDecimillicents: 50_000_000,
      stripeEventId: `evt_${eventId}`,
      chargeId: `ch_${eventId}`
    }
  })

const expectNotificationForEvent = async (input: {
  orgId: string
  userId: string
  event: SerializedDomainEvent
  titleIncludes?: string
}): Promise<void> => {
  const client = await pool().connect()
  try {
    await expectNotificationForOutboxEventWithClient(client, {
      organizationId: input.orgId,
      userId: input.userId,
      outboxEventId: input.event.id,
      eventType: input.event.eventType,
      titleIncludes: input.titleIncludes
    })
  } finally {
    client.release()
  }
}

beforeAll(() => {
  pool()
  void organizations
  void users
})

afterEach(async () => {
  _resetBillingEmailPortForTest()
  vi.unstubAllEnvs()
  resetWorkerEnvCache()
  await cleanupBillingOrganizations(pool(), {
    organizationIds: cleanupOrgIds,
    userIds: cleanupUserIds
  })
  cleanupOrgIds.length = 0
  cleanupUserIds.length = 0
})

describe('billing notification handler fan-out (integration)', () => {
  // Stub EmailDeliveryPort to succeed silently so we isolate the
  // in-app notification write path.
  const stubSuccessfulDelivery = () => {
    _setBillingEmailPortForTest({
      send: () => Effect.succeed({ messageId: 'stub-success' }),
      sendBatch: () => Effect.succeed([{ messageId: 'stub-success' }])
    })
  }

  it('creates an in-app notification for the org owner on welcome_credit_granted', async () => {
    stubSuccessfulDelivery()
    const { orgId, userId } = await seedOrg()
    const event = makeWelcomeEvent(orgId, `evt_${randomUUID()}`)

    const result = await billingActivities.notifyBillingEvent(event)
    expect(result.createdNotification).toBe(true)

    await expectNotificationForEvent({ orgId, userId, event, titleIncludes: 'welcome' })
  })

  // @spec INV-NOTIF-002 — dispatch is idempotent per outbox event id.
  it('is idempotent when called twice with the same outbox event id', async () => {
    stubSuccessfulDelivery()
    const { orgId, userId } = await seedOrg()
    const event = makeWelcomeEvent(orgId, `evt_${randomUUID()}`)

    const first = await billingActivities.notifyBillingEvent(event)
    const second = await billingActivities.notifyBillingEvent(event)
    expect(first.createdNotification).toBe(true)
    expect(second.createdNotification).toBe(false)

    await expectNotificationForEvent({ orgId, userId, event })
  })

  // @spec INV-NOTIF-002 — the DB unique index must collapse real races too,
  // not just serial duplicate calls that see the first row before creating.
  it('is race-safe when two workers fan out the same outbox event concurrently', async () => {
    const emailDelivery = createTestEmailDelivery()
    _setBillingEmailPortForTest(emailDelivery.port)
    const { orgId, userId } = await seedOrg()
    const event = makeWelcomeEvent(orgId, `evt_${randomUUID()}`)

    const [first, second] = await Promise.all([
      billingActivities.notifyBillingEvent(event),
      billingActivities.notifyBillingEvent(event)
    ])

    expect([first.createdNotification, second.createdNotification].sort()).toEqual([false, true])
    await expectNotificationForEvent({ orgId, userId, event })
    expect(emailDelivery.sends).toHaveLength(1)
  })

  // @spec INV-NOTIF-005 — email failures must never block in-app notification creation.
  it('creates the in-app notification even when the email delivery port fails', async () => {
    _setBillingEmailPortForTest({
      send: () =>
        Effect.fail(
          new EmailDeliveryError({
            to: 'test@example.com',
            reason: 'transport_error',
            statusCode: 500
          })
        ),
      sendBatch: () =>
        Effect.fail(
          new EmailDeliveryError({
            to: 'test@example.com',
            reason: 'transport_error',
            statusCode: 500
          })
        )
    })
    const { orgId, userId } = await seedOrg()
    const event = makeWelcomeEvent(orgId, `evt_${randomUUID()}`)

    const result = await billingActivities.notifyBillingEvent(event)
    expect(result.createdNotification).toBe(true)

    await expectNotificationForEvent({ orgId, userId, event })
  })

  it('sends a refund receipt email while creating the in-app notification', async () => {
    const emailDelivery = createTestEmailDelivery()
    _setBillingEmailPortForTest(emailDelivery.port)
    const { orgId, userId } = await seedOrg()
    const event = makeRefundEvent(orgId, `evt_${randomUUID()}`)

    const result = await billingActivities.notifyBillingEvent(event)
    expect(result.createdNotification).toBe(true)

    await expectNotificationForEvent({ orgId, userId, event })

    expect(emailDelivery.sends).toHaveLength(1)
    expect(emailDelivery.sends[0]?.to).toContain(`${TEST_PREFIX}-billing-${userId}`)
    expect(emailDelivery.sends[0]?.subject.toLowerCase()).toContain('refund')
    expect(emailDelivery.sends[0]?.htmlBody.toLowerCase()).toContain('$5.00')
  })

  it('builds billing email links from WEB_BASE_URL and the organization route', async () => {
    vi.stubEnv('WEB_BASE_URL', 'https://staging.tx-agent-kit.local/')
    resetWorkerEnvCache()
    const emailDelivery = createTestEmailDelivery()
    _setBillingEmailPortForTest(emailDelivery.port)
    const { orgId, userId } = await seedOrg()
    const event = makeWelcomeEvent(orgId, `evt_${randomUUID()}`)

    const result = await billingActivities.notifyBillingEvent(event)
    expect(result.createdNotification).toBe(true)

    await expectNotificationForEvent({ orgId, userId, event })
    expect(emailDelivery.sends).toHaveLength(1)
    expect(emailDelivery.sends[0]?.htmlBody).toContain(
      `https://staging.tx-agent-kit.local/org/${orgId}/billing`
    )
    expect(emailDelivery.sends[0]?.htmlBody).not.toContain(
      `https://tx-agent-kit.local/org/${orgId}/billing`
    )
  })

  it('falls back to the tx-agent-kit.local root domain when WEB_BASE_URL is unset', async () => {
    vi.stubEnv('WEB_BASE_URL', undefined)
    resetWorkerEnvCache()
    const emailDelivery = createTestEmailDelivery()
    _setBillingEmailPortForTest(emailDelivery.port)
    const { orgId, userId } = await seedOrg()
    const event = makeWelcomeEvent(orgId, `evt_${randomUUID()}`)

    const result = await billingActivities.notifyBillingEvent(event)
    expect(result.createdNotification).toBe(true)

    await expectNotificationForEvent({ orgId, userId, event })
    expect(emailDelivery.sends).toHaveLength(1)
    expect(emailDelivery.sends[0]?.htmlBody).toContain(
      `https://tx-agent-kit.local/org/${orgId}/billing`
    )
  })
})
