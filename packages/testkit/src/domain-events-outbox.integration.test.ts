import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDbAuthContext } from './db-auth-context.js'
import {
  backdateFailedAt,
  backdateProcessingAt,
  backdatePublishedAt,
  claimPendingEventsForProcessing,
  insertDomainEventDirect,
  markProcessingEventFailed,
  markProcessingEventsPublished,
  prunePublishedAndFailedEvents,
  queryDomainEventById,
  queryDomainEventsByAggregate,
  queryPendingDomainEvents,
  resetStuckProcessingEvents
} from './domain-events-outbox.js'

const apiCwd = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/api')

const dbAuthContext = createDbAuthContext({
  apiCwd,
  host: '127.0.0.1',
  port: Number.parseInt(process.env.TESTKIT_INTEGRATION_API_PORT ?? '4103', 10),
  authSecret: 'domain-events-integration-secret-32c',
  corsOrigin: '*',
  sql: {
    schemaPrefix: 'domain_events_outbox'
  }
})

beforeAll(async () => {
  await dbAuthContext.setup()
})

beforeEach(async () => {
  await dbAuthContext.reset()
})

afterAll(async () => {
  await dbAuthContext.teardown()
})

describe('domain events outbox integration', () => {
  it('creates a domain event when an organization is created via the API', async () => {
    const user = await dbAuthContext.createUser({
      email: 'domain-events-org@example.com',
      password: 'strong-pass-12345',
      name: 'Domain Events Test User'
    })

    const organization = await dbAuthContext.createTeam({
      token: user.token,
      name: 'Domain Events Test Org'
    })

    expect(organization.name).toBe('Domain Events Test Org')

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', organization.id)
    )

    expect(events).toHaveLength(1)

    const domainEvent = events[0]!
    expect(domainEvent.event_type).toBe('organization.created')
    expect(domainEvent.aggregate_type).toBe('organization')
    expect(domainEvent.aggregate_id).toBe(organization.id)
    expect(domainEvent.status).toBe('pending')
    expect(domainEvent.sequence_number).toBe(1)
    expect(domainEvent.published_at).toBeNull()
    expect(domainEvent.failed_at).toBeNull()
    expect(domainEvent.failure_reason).toBeNull()
    expect(domainEvent.payload).toEqual(
      expect.objectContaining({
        organizationName: 'Domain Events Test Org',
        ownerUserId: user.user.id
      })
    )
  })

  it('ensures atomicity — exactly one event per org creation', async () => {
    const user = await dbAuthContext.createUser({
      email: 'domain-events-atomicity@example.com',
      password: 'strong-pass-12345',
      name: 'Atomicity Test User'
    })

    const org = await dbAuthContext.createTeam({
      token: user.token,
      name: 'Atomicity Org'
    })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(events).toHaveLength(1)
  })

  it('supports full event lifecycle: pending → processing → published', async () => {
    const user = await dbAuthContext.createUser({
      email: 'domain-events-lifecycle@example.com',
      password: 'strong-pass-12345',
      name: 'Lifecycle Test User'
    })

    const org = await dbAuthContext.createTeam({
      token: user.token,
      name: 'Lifecycle Org'
    })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(events).toHaveLength(1)
    const eventId = events[0]!.id
    expect(events[0]!.status).toBe('pending')

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1)
    )

    const afterClaim = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(afterClaim!.status).toBe('processing')
    expect(afterClaim!.processing_at).not.toBeNull()

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventsPublished(client, [eventId])
    )

    const afterPublish = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(afterPublish!.status).toBe('published')
    expect(afterPublish!.published_at).not.toBeNull()
  })

  it('supports failure lifecycle: pending → processing → failed', async () => {
    const user = await dbAuthContext.createUser({
      email: 'domain-events-fail-lifecycle@example.com',
      password: 'strong-pass-12345',
      name: 'Fail Lifecycle Test User'
    })

    const org = await dbAuthContext.createTeam({
      token: user.token,
      name: 'Fail Lifecycle Org'
    })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(events).toHaveLength(1)
    const eventId = events[0]!.id

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1)
    )

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventFailed(client, eventId, 'test failure reason')
    )

    const afterFail = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(afterFail!.status).toBe('failed')
    expect(afterFail!.failed_at).not.toBeNull()
    expect(afterFail!.failure_reason).toBe('test failure reason')
  })

  it('fetches only pending events in occurred_at order', async () => {
    const user = await dbAuthContext.createUser({
      email: 'domain-events-fetch@example.com',
      password: 'strong-pass-12345',
      name: 'Fetch Test User'
    })

    const org1 = await dbAuthContext.createTeam({
      token: user.token,
      name: 'Fetch Org 1'
    })

    const org2 = await dbAuthContext.createTeam({
      token: user.token,
      name: 'Fetch Org 2'
    })

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const org1Events = await queryDomainEventsByAggregate(client, 'organization', org1.id)
      if (org1Events[0]) {
        await client.query(
          `UPDATE domain_events SET status = 'processing', processing_at = now() WHERE id = $1 AND status = 'pending'`,
          [org1Events[0].id]
        )
        await markProcessingEventsPublished(client, [org1Events[0].id])
      }
    })

    const pendingEvents = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client)
    )

    expect(pendingEvents.length).toBeGreaterThanOrEqual(1)
    expect(pendingEvents.every((e) => e.status === 'pending')).toBe(true)
    expect(pendingEvents.some((e) => e.aggregate_id === org2.id)).toBe(true)
    expect(pendingEvents.every((e) => e.aggregate_id !== org1.id)).toBe(true)
  })

  it('produces exactly one event per org across a batch of creations', async () => {
    const user = await dbAuthContext.createUser({
      email: 'domain-events-batch@example.com',
      password: 'strong-pass-12345',
      name: 'Batch Test User'
    })

    const orgNames = ['Batch Org A', 'Batch Org B', 'Batch Org C']
    const orgs = []
    for (const name of orgNames) {
      const org = await dbAuthContext.createTeam({ token: user.token, name })
      orgs.push(org)
    }

    for (const org of orgs) {
      const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
        queryDomainEventsByAggregate(client, 'organization', org.id)
      )

      expect(events).toHaveLength(1)
      expect(events[0]!.event_type).toBe('organization.created')
      expect(events[0]!.payload).toEqual(
        expect.objectContaining({ organizationName: org.name })
      )
    }

    const allPending = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client)
    )

    const batchOrgIds = new Set(orgs.map((o) => o.id))
    const batchEvents = allPending.filter((e) => batchOrgIds.has(e.aggregate_id))
    expect(batchEvents).toHaveLength(3)
  })

  it('orders pending events by occurred_at ascending', async () => {
    const user = await dbAuthContext.createUser({
      email: 'domain-events-order@example.com',
      password: 'strong-pass-12345',
      name: 'Order Test User'
    })

    await dbAuthContext.createTeam({ token: user.token, name: 'Order Org First' })
    await dbAuthContext.createTeam({ token: user.token, name: 'Order Org Second' })
    await dbAuthContext.createTeam({ token: user.token, name: 'Order Org Third' })

    const pendingEvents = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client)
    )

    const orderEvents = pendingEvents.filter((e) => {
      const name = e.payload['organizationName']
      return typeof name === 'string' && name.startsWith('Order Org')
    })

    expect(orderEvents.length).toBe(3)
    for (let i = 1; i < orderEvents.length; i++) {
      expect(orderEvents[i]!.occurred_at.getTime()).toBeGreaterThanOrEqual(
        orderEvents[i - 1]!.occurred_at.getTime()
      )
    }
  })

  it('enforces unique aggregate_id + sequence_number constraint', async () => {
    const user = await dbAuthContext.createUser({
      email: 'domain-events-unique@example.com',
      password: 'strong-pass-12345',
      name: 'Unique Constraint Test User'
    })

    const org = await dbAuthContext.createTeam({
      token: user.token,
      name: 'Unique Constraint Org'
    })

    const duplicateInsertError = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      try {
        await client.query(
          `INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, sequence_number)
           VALUES ('organization.created', 'organization', $1, '{}', 1)`,
          [org.id]
        )

        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })

    expect(duplicateInsertError).not.toBeNull()
    expect(duplicateInsertError).toContain('domain_events_aggregate_sequence_unique')
  })
})

describe('domain events outbox — claim and dispatch', () => {
  it('claimPendingEventsForProcessing atomically transitions events to processing', async () => {
    const user = await dbAuthContext.createUser({
      email: 'claim-atomic@example.com',
      password: 'strong-pass-12345',
      name: 'Claim Atomic User'
    })

    await dbAuthContext.createTeam({ token: user.token, name: 'Claim Org A' })
    await dbAuthContext.createTeam({ token: user.token, name: 'Claim Org B' })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 10)
    )

    expect(claimed.length).toBeGreaterThanOrEqual(2)
    for (const event of claimed) {
      expect(event.status).toBe('processing')
      expect(event.processing_at).not.toBeNull()
    }

    const pendingAfterClaim = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client)
    )

    const claimedIds = new Set(claimed.map((e) => e.id))
    const stillPending = pendingAfterClaim.filter((e) => claimedIds.has(e.id))
    expect(stillPending).toHaveLength(0)
  })

  it('markPublished only affects processing events (state guard)', async () => {
    const user = await dbAuthContext.createUser({
      email: 'mark-pub-guard@example.com',
      password: 'strong-pass-12345',
      name: 'Mark Published Guard User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Pub Guard Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id

    const rowsAffected = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventsPublished(client, [eventId])
    )

    expect(rowsAffected).toBe(0)

    const afterAttempt = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(afterAttempt!.status).toBe('pending')

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1)
    )

    const rowsPublished = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventsPublished(client, [eventId])
    )

    expect(rowsPublished).toBe(1)

    const afterPublish = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(afterPublish!.status).toBe('published')
  })

  it('markPublished is idempotent — second call is a no-op', async () => {
    const user = await dbAuthContext.createUser({
      email: 'mark-pub-idempotent@example.com',
      password: 'strong-pass-12345',
      name: 'Idempotent Publish User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Idempotent Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1)
    )

    const firstCall = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventsPublished(client, [eventId])
    )

    expect(firstCall).toBe(1)

    const secondCall = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventsPublished(client, [eventId])
    )

    expect(secondCall).toBe(0)

    const event = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(event!.status).toBe('published')
  })

  it('markFailed only affects processing events — no-op on pending', async () => {
    const user = await dbAuthContext.createUser({
      email: 'mark-fail-guard@example.com',
      password: 'strong-pass-12345',
      name: 'Mark Failed Guard User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Fail Guard Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id

    const rowsAffected = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventFailed(client, eventId, 'should be no-op')
    )

    expect(rowsAffected).toBe(0)

    const afterAttempt = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(afterAttempt!.status).toBe('pending')
    expect(afterAttempt!.failure_reason).toBeNull()

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1)
    )

    const rowsFailed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventFailed(client, eventId, 'genuine failure')
    )

    expect(rowsFailed).toBe(1)

    const afterFail = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(afterFail!.status).toBe('failed')
    expect(afterFail!.failure_reason).toBe('genuine failure')
    expect(afterFail!.failed_at).not.toBeNull()
  })

  it('dead-letter exclusion — fetchUnprocessed skips failed events', async () => {
    const user = await dbAuthContext.createUser({
      email: 'dead-letter@example.com',
      password: 'strong-pass-12345',
      name: 'Dead Letter User'
    })

    const org1 = await dbAuthContext.createTeam({ token: user.token, name: 'Dead Letter Org 1' })
    const org2 = await dbAuthContext.createTeam({ token: user.token, name: 'Dead Letter Org 2' })
    const org3 = await dbAuthContext.createTeam({ token: user.token, name: 'Dead Letter Org 3' })

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events1 = await queryDomainEventsByAggregate(client, 'organization', org1.id)
      const events2 = await queryDomainEventsByAggregate(client, 'organization', org2.id)

      const claimResult = await client.query(
        `UPDATE domain_events SET status = 'processing', processing_at = now() WHERE id = ANY($1) AND status = 'pending' RETURNING id`,
        [[events1[0]!.id, events2[0]!.id]]
      )
      expect(claimResult.rowCount).toBe(2)

      const published = await markProcessingEventsPublished(client, [events1[0]!.id])
      expect(published).toBe(1)

      const failed = await markProcessingEventFailed(client, events2[0]!.id, 'permanent failure')
      expect(failed).toBe(1)
    })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 50)
    )

    const orgIds = new Set([org1.id, org2.id, org3.id])
    const relevantClaimed = claimed.filter((e) => orgIds.has(e.aggregate_id))

    expect(relevantClaimed).toHaveLength(1)
    expect(relevantClaimed[0]!.aggregate_id).toBe(org3.id)
  })

  it('batch limit is binding — claims exactly N when more are available', async () => {
    const user = await dbAuthContext.createUser({
      email: 'batch-limit@example.com',
      password: 'strong-pass-12345',
      name: 'Batch Limit User'
    })

    await dbAuthContext.createTeam({ token: user.token, name: 'Batch Limit Org A' })
    await dbAuthContext.createTeam({ token: user.token, name: 'Batch Limit Org B' })
    await dbAuthContext.createTeam({ token: user.token, name: 'Batch Limit Org C' })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 2)
    )

    expect(claimed).toHaveLength(2)

    const remaining = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client)
    )

    expect(remaining.length).toBeGreaterThanOrEqual(1)
  })

  it('markFailed is idempotent — second call on already-failed event is a no-op', async () => {
    const user = await dbAuthContext.createUser({
      email: 'mark-fail-idempotent@example.com',
      password: 'strong-pass-12345',
      name: 'Fail Idempotent User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Fail Idempotent Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1)
    )

    const firstFail = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventFailed(client, eventId, 'first failure')
    )

    expect(firstFail).toBe(1)

    const secondFail = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventFailed(client, eventId, 'second attempt')
    )

    expect(secondFail).toBe(0)

    const event = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(event!.status).toBe('failed')
    expect(event!.failure_reason).toBe('first failure')
  })

  it('markFailed on already-published event is a no-op', async () => {
    const user = await dbAuthContext.createUser({
      email: 'mark-fail-published@example.com',
      password: 'strong-pass-12345',
      name: 'Fail Published User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Fail Published Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1)
    )

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventsPublished(client, [eventId])
    )

    const failResult = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventFailed(client, eventId, 'should not override published')
    )

    expect(failResult).toBe(0)

    const event = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(event!.status).toBe('published')
    expect(event!.failure_reason).toBeNull()
  })

  it('two concurrent pollers cannot claim the same event (FOR UPDATE SKIP LOCKED)', async () => {
    const user = await dbAuthContext.createUser({
      email: 'concurrent-poller@example.com',
      password: 'strong-pass-12345',
      name: 'Concurrent Poller User'
    })

    await dbAuthContext.createTeam({ token: user.token, name: 'Concurrent Poller Org' })

    const [claimed1, claimed2] = await Promise.all([
      dbAuthContext.testContext.withSchemaClient((client) =>
        claimPendingEventsForProcessing(client, 1)
      ),
      dbAuthContext.testContext.withSchemaClient((client) =>
        claimPendingEventsForProcessing(client, 1)
      )
    ])

    const allClaimed = [...claimed1, ...claimed2]
    const ids = allClaimed.map((e) => e.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(allClaimed.length).toBe(1)
  })
})

describe('domain events outbox — resetStuckProcessing', () => {
  it('resets stuck processing events back to pending', async () => {
    const user = await dbAuthContext.createUser({
      email: 'reset-stuck@example.com',
      password: 'strong-pass-12345',
      name: 'Reset Stuck User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Reset Stuck Org' })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1)
    )

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id
    expect(claimed.some((e) => e.id === eventId)).toBe(true)

    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000)
    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      backdateProcessingAt(client, eventId, tenMinutesAgo)
    )

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
    const resetIds = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      resetStuckProcessingEvents(client, fiveMinutesAgo)
    )

    expect(resetIds).toContain(eventId)

    const afterReset = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(afterReset!.status).toBe('pending')
    expect(afterReset!.processing_at).toBeNull()
  })

  it('does NOT reset recently-claimed processing events', async () => {
    const user = await dbAuthContext.createUser({
      email: 'reset-fresh@example.com',
      password: 'strong-pass-12345',
      name: 'Reset Fresh User'
    })

    await dbAuthContext.createTeam({ token: user.token, name: 'Reset Fresh Org' })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1)
    )

    expect(claimed).toHaveLength(1)
    const eventId = claimed[0]!.id

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
    const resetIds = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      resetStuckProcessingEvents(client, fiveMinutesAgo)
    )

    expect(resetIds).not.toContain(eventId)

    const afterReset = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventById(client, eventId)
    )

    expect(afterReset!.status).toBe('processing')
    expect(afterReset!.processing_at).not.toBeNull()
  })

  it('reset events can be re-claimed by the poller', async () => {
    const user = await dbAuthContext.createUser({
      email: 'reset-reclaim@example.com',
      password: 'strong-pass-12345',
      name: 'Reset Reclaim User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Reset Reclaim Org' })

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 10)
    )

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id
    expect(events[0]!.status).toBe('processing')

    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000)
    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      backdateProcessingAt(client, eventId, tenMinutesAgo)
    )

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
    const resetIds = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      resetStuckProcessingEvents(client, fiveMinutesAgo)
    )
    expect(resetIds).toContain(eventId)

    const reClaimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 10)
    )

    const reClaimedEvent = reClaimed.find((e) => e.id === eventId)
    expect(reClaimedEvent).toBeDefined()
    expect(reClaimedEvent!.status).toBe('processing')
    expect(reClaimedEvent!.processing_at).not.toBeNull()
  })
})

describe('domain events outbox — sequence number auto-increment', () => {
  it('auto-increments sequence_number for same aggregate_id', async () => {
    const user = await dbAuthContext.createUser({
      email: 'seq-auto@example.com',
      password: 'strong-pass-12345',
      name: 'Sequence Auto User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Sequence Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.sequence_number).toBe(1)

    const secondEvent = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      insertDomainEventDirect(client, {
        eventType: 'organization.created',
        aggregateType: 'organization',
        aggregateId: org.id,
        payload: { organizationName: 'Sequence Org', ownerUserId: user.user.id }
      })
    )

    expect(secondEvent.sequence_number).toBe(2)

    const thirdEvent = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      insertDomainEventDirect(client, {
        eventType: 'organization.created',
        aggregateType: 'organization',
        aggregateId: org.id,
        payload: { organizationName: 'Sequence Org', ownerUserId: user.user.id }
      })
    )

    expect(thirdEvent.sequence_number).toBe(3)

    const allEvents = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(allEvents).toHaveLength(3)
    expect(allEvents.map((e) => e.sequence_number)).toEqual([1, 2, 3])
  })

  it('maintains independent sequence numbers per aggregate', async () => {
    const user = await dbAuthContext.createUser({
      email: 'seq-independent@example.com',
      password: 'strong-pass-12345',
      name: 'Independent Seq User'
    })

    const org1 = await dbAuthContext.createTeam({ token: user.token, name: 'Seq Org 1' })
    const org2 = await dbAuthContext.createTeam({ token: user.token, name: 'Seq Org 2' })

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      insertDomainEventDirect(client, {
        eventType: 'organization.created',
        aggregateType: 'organization',
        aggregateId: org1.id
      })
    )

    const org1Events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org1.id)
    )

    const org2Events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org2.id)
    )

    expect(org1Events.map((e) => e.sequence_number)).toEqual([1, 2])
    expect(org2Events.map((e) => e.sequence_number)).toEqual([1])
  })
})

describe('domain events outbox — pruning', () => {
  it('prunes published and failed events older than threshold', async () => {
    const user = await dbAuthContext.createUser({
      email: 'prune-old@example.com',
      password: 'strong-pass-12345',
      name: 'Prune Old User'
    })

    const org1 = await dbAuthContext.createTeam({ token: user.token, name: 'Prune Org Published' })
    const org2 = await dbAuthContext.createTeam({ token: user.token, name: 'Prune Org Failed' })
    const org3 = await dbAuthContext.createTeam({ token: user.token, name: 'Prune Org Pending' })

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events1 = await queryDomainEventsByAggregate(client, 'organization', org1.id)
      const events2 = await queryDomainEventsByAggregate(client, 'organization', org2.id)

      await client.query(
        `UPDATE domain_events SET status = 'processing', processing_at = now() WHERE id = ANY($1) AND status = 'pending'`,
        [[events1[0]!.id, events2[0]!.id]]
      )

      await markProcessingEventsPublished(client, [events1[0]!.id])
      await markProcessingEventFailed(client, events2[0]!.id, 'test failure')

      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60_000)
      await backdatePublishedAt(client, events1[0]!.id, fortyEightHoursAgo)
      await backdateFailedAt(client, events2[0]!.id, fortyEightHoursAgo)
    })

    const olderThan = new Date(Date.now() - 24 * 60 * 60_000)
    const deleted = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      prunePublishedAndFailedEvents(client, olderThan)
    )

    expect(deleted).toBe(2)

    const prunedPublished = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org1.id)
    )

    expect(prunedPublished).toHaveLength(0)

    const prunedFailed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org2.id)
    )

    expect(prunedFailed).toHaveLength(0)

    const pendingStillExists = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org3.id)
    )

    expect(pendingStillExists).toHaveLength(1)
    expect(pendingStillExists[0]!.status).toBe('pending')
  })

  it('prune does not delete recent published events', async () => {
    const user = await dbAuthContext.createUser({
      email: 'prune-recent@example.com',
      password: 'strong-pass-12345',
      name: 'Prune Recent User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Prune Recent Org' })

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events = await queryDomainEventsByAggregate(client, 'organization', org.id)
      await client.query(
        `UPDATE domain_events SET status = 'processing', processing_at = now() WHERE id = $1 AND status = 'pending'`,
        [events[0]!.id]
      )
      await markProcessingEventsPublished(client, [events[0]!.id])
    })

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000)
    const deleted = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      prunePublishedAndFailedEvents(client, thirtyDaysAgo)
    )

    expect(deleted).toBe(0)

    const stillExists = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(stillExists).toHaveLength(1)
    expect(stillExists[0]!.status).toBe('published')
  })
})

describe('domain events outbox — pruning edge cases', () => {
  it('pruning does not touch processing events', async () => {
    const user = await dbAuthContext.createUser({
      email: 'prune-processing@example.com',
      password: 'strong-pass-12345',
      name: 'Prune Processing User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Prune Processing Org' })

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events = await queryDomainEventsByAggregate(client, 'organization', org.id)
      await claimPendingEventsForProcessing(client, 1)

      const tenMinutesAgo = new Date(Date.now() - 10 * 60_000)
      await backdateProcessingAt(client, events[0]!.id, tenMinutesAgo)
    })

    const oneMinuteAgo = new Date(Date.now() - 60_000)
    const deleted = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      prunePublishedAndFailedEvents(client, oneMinuteAgo)
    )

    expect(deleted).toBe(0)

    const stillExists = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(stillExists).toHaveLength(1)
    expect(stillExists[0]!.status).toBe('processing')
  })

  it('pruning boundary — event exactly at threshold is pruned', async () => {
    const user = await dbAuthContext.createUser({
      email: 'prune-boundary@example.com',
      password: 'strong-pass-12345',
      name: 'Prune Boundary User'
    })

    const org = await dbAuthContext.createTeam({ token: user.token, name: 'Prune Boundary Org' })

    const threshold = new Date(Date.now() - 24 * 60 * 60_000)

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events = await queryDomainEventsByAggregate(client, 'organization', org.id)
      await client.query(
        `UPDATE domain_events SET status = 'processing', processing_at = now() WHERE id = $1 AND status = 'pending'`,
        [events[0]!.id]
      )
      await markProcessingEventsPublished(client, [events[0]!.id])
      await backdatePublishedAt(client, events[0]!.id, threshold)
    })

    const deleted = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      prunePublishedAndFailedEvents(client, threshold)
    )

    expect(deleted).toBe(1)
  })

  it('resetStuckProcessing ignores published and failed events', async () => {
    const user = await dbAuthContext.createUser({
      email: 'reset-terminal@example.com',
      password: 'strong-pass-12345',
      name: 'Reset Terminal User'
    })

    const org1 = await dbAuthContext.createTeam({ token: user.token, name: 'Reset Terminal Org 1' })
    const org2 = await dbAuthContext.createTeam({ token: user.token, name: 'Reset Terminal Org 2' })

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events1 = await queryDomainEventsByAggregate(client, 'organization', org1.id)
      const events2 = await queryDomainEventsByAggregate(client, 'organization', org2.id)

      await client.query(
        `UPDATE domain_events SET status = 'processing', processing_at = now() WHERE id = ANY($1) AND status = 'pending'`,
        [[events1[0]!.id, events2[0]!.id]]
      )

      await markProcessingEventsPublished(client, [events1[0]!.id])
      await markProcessingEventFailed(client, events2[0]!.id, 'terminal failure')
    })

    const oneMinuteAgo = new Date(Date.now() - 60_000)
    const resetIds = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      resetStuckProcessingEvents(client, oneMinuteAgo)
    )

    expect(resetIds).toHaveLength(0)

    const pub = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org1.id)
    )

    const fail = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org2.id)
    )

    expect(pub[0]!.status).toBe('published')
    expect(fail[0]!.status).toBe('failed')
  })

  it('batch limit 0 claims no events', async () => {
    const user = await dbAuthContext.createUser({
      email: 'batch-zero@example.com',
      password: 'strong-pass-12345',
      name: 'Batch Zero User'
    })

    await dbAuthContext.createTeam({ token: user.token, name: 'Batch Zero Org' })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 0)
    )

    expect(claimed).toHaveLength(0)

    const stillPending = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client)
    )

    expect(stillPending.length).toBeGreaterThanOrEqual(1)
  })
})

describe('domain events outbox — edge cases', () => {
  it('markPublished with empty array is a no-op', async () => {
    const result = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      markProcessingEventsPublished(client, [])
    )

    expect(result).toBe(0)
  })

  it('claimPendingEventsForProcessing returns empty when no pending events', async () => {
    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 10)
    )

    expect(claimed).toHaveLength(0)
  })

  it('resetStuckProcessingEvents returns empty when no stuck events', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
    const resetIds = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      resetStuckProcessingEvents(client, fiveMinutesAgo)
    )

    expect(resetIds).toHaveLength(0)
  })
})
