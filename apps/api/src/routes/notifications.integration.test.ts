/**
 * Integration tests for the notifications domain scaffolding (Phase 1).
 *
 * Phase 1 is deliberately small — no HTTP routes, no dispatch workflows,
 * no preferences. Just the five core repository operations that the
 * billing worker handler (Slice 6) will drive. We hit the repository
 * directly rather than through a controller so the test suite isn't
 * blocked on UI / routing decisions that are out of scope for Slice 4.
 *
 * @spec notifications-design §"Minimal-First Implementation Plan"
 * @spec INV-NOTIF-001 — in-app notifications are always created.
 * @spec INV-NOTIF-006 — notifications are org-scoped.
 */
import { randomUUID } from 'node:crypto'
import { notificationsRepository } from '@tx-agent-kit/db'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './test-helpers.js'

const uid = randomUUID().slice(0, 8)

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'api_notifications'
})

const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

describe('notifications domain scaffolding [INV-NOTIF-001] [INV-NOTIF-006]', () => {
  it('creates a notification row for a user in an org', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `notif-create-${uid}@example.com`,
      password: 'notifications-scaffold-pass-12345',
      name: 'Notif Create'
    })
    const org = await createOrganization(ctx, { token: owner.token, name: `Notif Create Org ${uid}` })

    const created = await runEffect(
      notificationsRepository.create({
        organizationId: org.id,
        userId: owner.user.id,
        eventType: 'billing.welcome_credit_granted',
        title: 'Welcome credit granted',
        body: 'We gave you $20 to try Pro.',
        metadata: { amountDecimillicents: 20_000_000, plan: 'pro' }
      })
    )

    expect(created.id).toBeDefined()
    expect(created.organizationId).toBe(org.id)
    expect(created.userId).toBe(owner.user.id)
    expect(created.eventType).toBe('billing.welcome_credit_granted')
    expect(created.title).toBe('Welcome credit granted')
    expect(created.body).toBe('We gave you $20 to try Pro.')
    expect(created.metadata).toMatchObject({ amountDecimillicents: 20_000_000, plan: 'pro' })
    expect(created.readAt).toBeNull()
  })

  it('lists notifications for a user newest-first with cursor pagination', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `notif-list-${uid}@example.com`,
      password: 'notifications-scaffold-pass-12345',
      name: 'Notif List'
    })
    const org = await createOrganization(ctx, { token: owner.token, name: `Notif List Org ${uid}` })

    for (let i = 0; i < 5; i += 1) {
      await runEffect(
        notificationsRepository.create({
          organizationId: org.id,
          userId: owner.user.id,
          eventType: 'billing.credits_low_balance',
          title: `Low balance #${i}`,
          body: `Balance is low (${i}).`
        })
      )
      // Small spacing so created_at orders deterministically.
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const firstPage = await runEffect(
      notificationsRepository.listForUser({
        userId: owner.user.id,
        organizationId: org.id,
        limit: 3
      })
    )
    expect(firstPage).toHaveLength(3)
    expect(firstPage[0]?.title).toBe('Low balance #4') // newest first

    const oldestInFirstPage = firstPage[2]?.createdAt
    if (!oldestInFirstPage) {
      throw new Error('first page missing cursor row')
    }
    const secondPage = await runEffect(
      notificationsRepository.listForUser({
        userId: owner.user.id,
        organizationId: org.id,
        limit: 3,
        cursor: oldestInFirstPage
      })
    )
    expect(secondPage).toHaveLength(2)
    expect(secondPage[0]?.title).toBe('Low balance #1')
    expect(secondPage[1]?.title).toBe('Low balance #0')
  })

  // @spec INV-NOTIF-006 — notifications are org-scoped.
  it('does not surface notifications from a different org to the same user', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `notif-scope-${uid}@example.com`,
      password: 'notifications-scaffold-pass-12345',
      name: 'Notif Scope'
    })
    const orgA = await createOrganization(ctx, { token: owner.token, name: `Scope A ${uid}` })
    const orgB = await createOrganization(ctx, { token: owner.token, name: `Scope B ${uid}` })

    await runEffect(
      notificationsRepository.create({
        organizationId: orgA.id,
        userId: owner.user.id,
        eventType: 'billing.credits_purchased',
        title: 'Org A credit',
        body: 'Bought credits in A.'
      })
    )
    await runEffect(
      notificationsRepository.create({
        organizationId: orgB.id,
        userId: owner.user.id,
        eventType: 'billing.credits_purchased',
        title: 'Org B credit',
        body: 'Bought credits in B.'
      })
    )

    const aList = await runEffect(
      notificationsRepository.listForUser({
        userId: owner.user.id,
        organizationId: orgA.id
      })
    )
    expect(aList).toHaveLength(1)
    expect(aList[0]?.title).toBe('Org A credit')

    const bList = await runEffect(
      notificationsRepository.listForUser({
        userId: owner.user.id,
        organizationId: orgB.id
      })
    )
    expect(bList).toHaveLength(1)
    expect(bList[0]?.title).toBe('Org B credit')
  })

  it('marks a notification as read and updates unread count', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `notif-read-${uid}@example.com`,
      password: 'notifications-scaffold-pass-12345',
      name: 'Notif Read'
    })
    const org = await createOrganization(ctx, { token: owner.token, name: `Read Org ${uid}` })

    const [one, two] = await Promise.all([
      runEffect(
        notificationsRepository.create({
          organizationId: org.id,
          userId: owner.user.id,
          eventType: 'billing.payment_failed',
          title: 'Payment failed #1',
          body: 'Your card was declined.'
        })
      ),
      runEffect(
        notificationsRepository.create({
          organizationId: org.id,
          userId: owner.user.id,
          eventType: 'billing.payment_failed',
          title: 'Payment failed #2',
          body: 'Your card was declined again.'
        })
      )
    ])

    const unreadBefore = await runEffect(
      notificationsRepository.countUnread({
        userId: owner.user.id,
        organizationId: org.id
      })
    )
    expect(unreadBefore).toBe(2)

    const markedFirst = await runEffect(
      notificationsRepository.markRead({
        id: one.id,
        userId: owner.user.id
      })
    )
    expect(markedFirst).not.toBeNull()
    expect(markedFirst?.readAt).not.toBeNull()

    const unreadAfter = await runEffect(
      notificationsRepository.countUnread({
        userId: owner.user.id,
        organizationId: org.id
      })
    )
    expect(unreadAfter).toBe(1)

    // Marking the same row again is a no-op — returns null because the
    // partial index `readAt IS NULL` filters it out.
    const markedAgain = await runEffect(
      notificationsRepository.markRead({
        id: one.id,
        userId: owner.user.id
      })
    )
    expect(markedAgain).toBeNull()

    // Mark-read refuses to touch rows the caller doesn't own — the
    // composite (id, userId) WHERE returns no rows when the userId is wrong.
    const stranger = await createUser(ctx, {
      email: `notif-stranger-${uid}@example.com`,
      password: 'notifications-scaffold-pass-12345',
      name: 'Stranger'
    })
    const crossUser = await runEffect(
      notificationsRepository.markRead({
        id: two.id,
        userId: stranger.user.id
      })
    )
    expect(crossUser).toBeNull()

    // Row two is still unread — the stranger couldn't mark it.
    const unreadFinal = await runEffect(
      notificationsRepository.countUnread({
        userId: owner.user.id,
        organizationId: org.id
      })
    )
    expect(unreadFinal).toBe(1)
  })

  // @spec INV-NOTIF-001 — in-app notifications are always created.
  it('createBatch returns every row and supports mixed event types', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `notif-batch-${uid}@example.com`,
      password: 'notifications-scaffold-pass-12345',
      name: 'Notif Batch'
    })
    const org = await createOrganization(ctx, { token: owner.token, name: `Batch Org ${uid}` })

    const inputs = [
      {
        organizationId: org.id,
        userId: owner.user.id,
        eventType: 'billing.credits_low_balance',
        title: 'Low balance',
        body: 'Balance is low.'
      },
      {
        organizationId: org.id,
        userId: owner.user.id,
        eventType: 'billing.usage_cap_warning',
        title: 'Usage cap 80%',
        body: 'You are at 80% of your cap.'
      },
      {
        organizationId: org.id,
        userId: owner.user.id,
        eventType: 'billing.recharge_requires_action',
        title: '3DS required',
        body: 'Please complete the bank challenge.'
      }
    ]

    const created = await runEffect(notificationsRepository.createBatch(inputs))
    expect(created).toHaveLength(3)
    expect(created.map((n) => n.eventType).sort()).toEqual(
      [
        'billing.credits_low_balance',
        'billing.recharge_requires_action',
        'billing.usage_cap_warning'
      ].sort()
    )
  })
})
