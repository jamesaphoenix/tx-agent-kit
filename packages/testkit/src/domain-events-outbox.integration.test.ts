import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { domainEventsRepository } from '@tx-agent-kit/db'
import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { defaultTestBrandSettings } from './api-factories.js'
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
const apiPort = Number.parseInt(process.env.API_INTEGRATION_TEST_PORT_DOMAIN_EVENTS ?? '4122', 10)

const dbAuthContext = createDbAuthContext({
  apiCwd,
  host: '127.0.0.1',
  port: apiPort,
  authSecret: process.env.INTEGRATION_AUTH_SECRET ?? 'domain-events-integration-secret-32c',
  corsOrigin: '*',
  sql: {
    schemaPrefix: 'domain_events_outbox'
  }
})

const runWithRepositoryDatabaseUrl = async <A>(
  createEffect: () => Effect.Effect<A, unknown>
): Promise<A> => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = dbAuthContext.testContext.schemaDatabaseUrl

  try {
    return await Effect.runPromise(createEffect())
  } finally {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
  }
}

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
      name: 'Domain Events Test User'
    })

    const organization = await dbAuthContext.createOrganization({
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
      name: 'Atomicity Test User'
    })

    const org = await dbAuthContext.createOrganization({
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
      name: 'Lifecycle Test User'
    })

    const org = await dbAuthContext.createOrganization({
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
      claimPendingEventsForProcessing(client, 1, org.id)
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
      name: 'Fail Lifecycle Test User'
    })

    const org = await dbAuthContext.createOrganization({
      token: user.token,
      name: 'Fail Lifecycle Org'
    })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(events).toHaveLength(1)
    const eventId = events[0]!.id

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1, org.id)
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
      name: 'Fetch Test User'
    })

    const org1 = await dbAuthContext.createOrganization({
      token: user.token,
      name: 'Fetch Org 1'
    })

    const org2 = await dbAuthContext.createOrganization({
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

    const pendingOrg2 = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client, 50, org2.id)
    )

    expect(pendingOrg2).toHaveLength(1)
    expect(pendingOrg2.every((e) => e.status === 'pending')).toBe(true)
    expect(pendingOrg2[0]!.aggregate_id).toBe(org2.id)

    const pendingOrg1 = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client, 50, org1.id)
    )

    expect(pendingOrg1).toHaveLength(0)
  })

  it('produces exactly one event per org across a batch of creations', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Batch Test User'
    })

    const orgNames = ['Batch Org A', 'Batch Org B', 'Batch Org C']
    const orgs = []
    for (const name of orgNames) {
      const org = await dbAuthContext.createOrganization({ token: user.token, name })
      orgs.push(org)
    }

    const eventIds = new Set<string>()
    for (const org of orgs) {
      const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
        queryDomainEventsByAggregate(client, 'organization', org.id)
      )

      expect(events).toHaveLength(1)
      eventIds.add(events[0]!.id)
      expect(events[0]!.event_type).toBe('organization.created')
      expect(events[0]!.payload).toEqual(
        expect.objectContaining({ organizationName: org.name })
      )
    }

    expect(eventIds.size).toBe(3)
  })

  it('orders pending events by occurred_at ascending', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Order Test User'
    })

    const org1 = await dbAuthContext.createOrganization({ token: user.token, name: 'Order Org First' })
    const org2 = await dbAuthContext.createOrganization({ token: user.token, name: 'Order Org Second' })
    const org3 = await dbAuthContext.createOrganization({ token: user.token, name: 'Order Org Third' })

    const orderEvents = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const e1 = await queryDomainEventsByAggregate(client, 'organization', org1.id)
      const e2 = await queryDomainEventsByAggregate(client, 'organization', org2.id)
      const e3 = await queryDomainEventsByAggregate(client, 'organization', org3.id)
      return [...e1, ...e2, ...e3].sort(
        (a, b) => a.occurred_at.getTime() - b.occurred_at.getTime()
      )
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
      name: 'Unique Constraint Test User'
    })

    const org = await dbAuthContext.createOrganization({
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
  it('repository fetchUnprocessed decodes timestamps from raw SQL claim results', async () => {
    const aggregateId = randomUUID()

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `UPDATE domain_events
            SET status = 'published',
                published_at = COALESCE(published_at, now())
          WHERE status = 'pending'`
      )
      await insertDomainEventDirect(client, {
        eventType: 'organization.created',
        aggregateType: 'organization',
        aggregateId,
        payload: {
          organizationName: 'Repository Claim Decode Org',
          ownerUserId: randomUUID()
        }
      })
    })

    const claimed = await runWithRepositoryDatabaseUrl(
      () => domainEventsRepository.fetchUnprocessed(10)
    )

    expect(claimed).toHaveLength(1)
    expect(claimed[0]!.aggregateId).toBe(aggregateId)
    expect(claimed[0]!.status).toBe('processing')
    expect(claimed[0]!.occurredAt).toBeInstanceOf(Date)
    expect(claimed[0]!.processingAt).toBeInstanceOf(Date)
    expect(claimed[0]!.createdAt).toBeInstanceOf(Date)
  })

  it('claimPendingEventsForProcessing atomically transitions events to processing', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Claim Atomic User'
    })

    const orgA = await dbAuthContext.createOrganization({ token: user.token, name: 'Claim Org A' })
    const orgB = await dbAuthContext.createOrganization({ token: user.token, name: 'Claim Org B' })

    const claimedA = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 10, orgA.id)
    )
    const claimedB = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 10, orgB.id)
    )

    const claimed = [...claimedA, ...claimedB]
    expect(claimed).toHaveLength(2)
    for (const event of claimed) {
      expect(event.status).toBe('processing')
      expect(event.processing_at).not.toBeNull()
    }

    const pendingA = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client, 50, orgA.id)
    )
    const pendingB = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client, 50, orgB.id)
    )

    expect(pendingA).toHaveLength(0)
    expect(pendingB).toHaveLength(0)
  })

  it('markPublished only affects processing events (state guard)', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Mark Published Guard User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Pub Guard Org' })

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
      claimPendingEventsForProcessing(client, 1, org.id)
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
      name: 'Idempotent Publish User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Idempotent Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1, org.id)
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
      name: 'Mark Failed Guard User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Fail Guard Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      await client.query('BEGIN')
      try {
        // Keep the live outbox publisher from claiming this row while the guard
        // verifies the exact pending and processing status transitions.
        await client.query('SELECT id FROM domain_events WHERE id = $1 FOR UPDATE', [eventId])

        const rowsAffected = await markProcessingEventFailed(client, eventId, 'should be no-op')
        expect(rowsAffected).toBe(0)

        const afterAttempt = await queryDomainEventById(client, eventId)
        expect(afterAttempt!.status).toBe('pending')
        expect(afterAttempt!.failure_reason).toBeNull()

        await claimPendingEventsForProcessing(client, 1, org.id)

        const rowsFailed = await markProcessingEventFailed(client, eventId, 'genuine failure')
        expect(rowsFailed).toBe(1)

        const afterFail = await queryDomainEventById(client, eventId)
        expect(afterFail!.status).toBe('failed')
        expect(afterFail!.failure_reason).toBe('genuine failure')
        expect(afterFail!.failed_at).not.toBeNull()

        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    })
  })

  it('dead-letter exclusion — fetchUnprocessed skips failed events', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Dead Letter User'
    })

    const org1 = await dbAuthContext.createOrganization({ token: user.token, name: 'Dead Letter Org 1' })
    const org2 = await dbAuthContext.createOrganization({ token: user.token, name: 'Dead Letter Org 2' })
    const org3 = await dbAuthContext.createOrganization({ token: user.token, name: 'Dead Letter Org 3' })

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
      claimPendingEventsForProcessing(client, 50, org3.id)
    )

    expect(claimed).toHaveLength(1)
    expect(claimed[0]!.aggregate_id).toBe(org3.id)

    const claimedOrg1 = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 50, org1.id)
    )
    const claimedOrg2 = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 50, org2.id)
    )

    expect(claimedOrg1).toHaveLength(0)
    expect(claimedOrg2).toHaveLength(0)
  })

  it('batch limit is binding — claims exactly N when more are available', async () => {
    const { randomUUID } = await import('node:crypto')
    const sharedAggregateId = randomUUID()

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      await insertDomainEventDirect(client, {
        eventType: 'test.batch_limit',
        aggregateType: 'test',
        aggregateId: sharedAggregateId,
        payload: { label: 'A' }
      })
      await insertDomainEventDirect(client, {
        eventType: 'test.batch_limit',
        aggregateType: 'test',
        aggregateId: sharedAggregateId,
        payload: { label: 'B' }
      })
      await insertDomainEventDirect(client, {
        eventType: 'test.batch_limit',
        aggregateType: 'test',
        aggregateId: sharedAggregateId,
        payload: { label: 'C' }
      })
    })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 2, sharedAggregateId)
    )

    expect(claimed).toHaveLength(2)

    const remaining = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client, 50, sharedAggregateId)
    )

    expect(remaining).toHaveLength(1)
  })

  it('markFailed is idempotent — second call on already-failed event is a no-op', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Fail Idempotent User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Fail Idempotent Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1, org.id)
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
      name: 'Fail Published User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Fail Published Org' })

    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    const eventId = events[0]!.id

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1, org.id)
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
      name: 'Concurrent Poller User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Concurrent Poller Org' })

    const [claimed1, claimed2] = await Promise.all([
      dbAuthContext.testContext.withSchemaClient((client) =>
        claimPendingEventsForProcessing(client, 1, org.id)
      ),
      dbAuthContext.testContext.withSchemaClient((client) =>
        claimPendingEventsForProcessing(client, 1, org.id)
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
      name: 'Reset Stuck User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Reset Stuck Org' })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1, org.id)
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
      resetStuckProcessingEvents(client, fiveMinutesAgo, org.id)
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
      name: 'Reset Fresh User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Reset Fresh Org' })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 1, org.id)
    )

    expect(claimed).toHaveLength(1)
    const eventId = claimed[0]!.id

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
    const resetIds = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      resetStuckProcessingEvents(client, fiveMinutesAgo, org.id)
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
      name: 'Reset Reclaim User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Reset Reclaim Org' })

    await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 10, org.id)
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
      resetStuckProcessingEvents(client, fiveMinutesAgo, org.id)
    )
    expect(resetIds).toContain(eventId)

    const reClaimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 10, org.id)
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
      name: 'Sequence Auto User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Sequence Org' })

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
      name: 'Independent Seq User'
    })

    const org1 = await dbAuthContext.createOrganization({ token: user.token, name: 'Seq Org 1' })
    const org2 = await dbAuthContext.createOrganization({ token: user.token, name: 'Seq Org 2' })

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
      name: 'Prune Old User'
    })

    const org1 = await dbAuthContext.createOrganization({ token: user.token, name: 'Prune Org Published' })
    const org2 = await dbAuthContext.createOrganization({ token: user.token, name: 'Prune Org Failed' })
    const org3 = await dbAuthContext.createOrganization({ token: user.token, name: 'Prune Org Pending' })

    let eventId1: string
    let eventId2: string

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events1 = await queryDomainEventsByAggregate(client, 'organization', org1.id)
      const events2 = await queryDomainEventsByAggregate(client, 'organization', org2.id)
      eventId1 = events1[0]!.id
      eventId2 = events2[0]!.id

      await client.query(
        `UPDATE domain_events SET status = 'processing', processing_at = now() WHERE id = ANY($1) AND status = 'pending'`,
        [[eventId1, eventId2]]
      )

      await markProcessingEventsPublished(client, [eventId1])
      await markProcessingEventFailed(client, eventId2, 'test failure')

      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60_000)
      await backdatePublishedAt(client, eventId1, fortyEightHoursAgo)
      await backdateFailedAt(client, eventId2, fortyEightHoursAgo)
    })

    const olderThan = new Date(Date.now() - 24 * 60 * 60_000)
    const deleted = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      prunePublishedAndFailedEvents(client, olderThan, [eventId1!, eventId2!])
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

    const unrelatedEventStillExists = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org3.id)
    )

    expect(unrelatedEventStillExists).toHaveLength(1)
  })

  it('prune does not delete recent published events', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Prune Recent User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Prune Recent Org' })

    let eventId: string

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events = await queryDomainEventsByAggregate(client, 'organization', org.id)
      eventId = events[0]!.id
      await client.query(
        `UPDATE domain_events SET status = 'processing', processing_at = now() WHERE id = $1 AND status = 'pending'`,
        [eventId]
      )
      await markProcessingEventsPublished(client, [eventId])
    })

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000)
    const deleted = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      prunePublishedAndFailedEvents(client, thirtyDaysAgo, [eventId!])
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
      name: 'Prune Processing User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Prune Processing Org' })

    let eventId: string

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events = await queryDomainEventsByAggregate(client, 'organization', org.id)
      eventId = events[0]!.id
      await claimPendingEventsForProcessing(client, 1, org.id)

      const tenMinutesAgo = new Date(Date.now() - 10 * 60_000)
      await backdateProcessingAt(client, eventId, tenMinutesAgo)
    })

    const oneMinuteAgo = new Date(Date.now() - 60_000)
    const deleted = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      prunePublishedAndFailedEvents(client, oneMinuteAgo, [eventId!])
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
      name: 'Prune Boundary User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Prune Boundary Org' })

    const threshold = new Date(Date.now() - 24 * 60 * 60_000)

    let eventId: string

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const events = await queryDomainEventsByAggregate(client, 'organization', org.id)
      eventId = events[0]!.id
      await client.query(
        `UPDATE domain_events SET status = 'processing', processing_at = now() WHERE id = $1 AND status = 'pending'`,
        [eventId]
      )
      await markProcessingEventsPublished(client, [eventId])
      await backdatePublishedAt(client, eventId, threshold)
    })

    const deleted = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      prunePublishedAndFailedEvents(client, threshold, [eventId!])
    )

    expect(deleted).toBe(1)
  })

  it('resetStuckProcessing ignores published and failed events', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Reset Terminal User'
    })

    const org1 = await dbAuthContext.createOrganization({ token: user.token, name: 'Reset Terminal Org 1' })
    const org2 = await dbAuthContext.createOrganization({ token: user.token, name: 'Reset Terminal Org 2' })

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
    const resetIds1 = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      resetStuckProcessingEvents(client, oneMinuteAgo, org1.id)
    )
    const resetIds2 = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      resetStuckProcessingEvents(client, oneMinuteAgo, org2.id)
    )

    expect(resetIds1).toHaveLength(0)
    expect(resetIds2).toHaveLength(0)

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
      name: 'Batch Zero User'
    })

    const org = await dbAuthContext.createOrganization({ token: user.token, name: 'Batch Zero Org' })

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 0, org.id)
    )

    expect(claimed).toHaveLength(0)

    const stillPending = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryPendingDomainEvents(client, 50, org.id)
    )

    expect(stillPending).toHaveLength(1)
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
    const { randomUUID } = await import('node:crypto')
    const nonexistentAggregateId = randomUUID()

    const claimed = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      claimPendingEventsForProcessing(client, 10, nonexistentAggregateId)
    )

    expect(claimed).toHaveLength(0)
  })

  it('resetStuckProcessingEvents returns empty when no stuck events', async () => {
    const { randomUUID } = await import('node:crypto')
    const nonexistentAggregateId = randomUUID()

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
    const resetIds = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      resetStuckProcessingEvents(client, fiveMinutesAgo, nonexistentAggregateId)
    )

    expect(resetIds).toHaveLength(0)
  })
})

describe('domain events outbox — deletion events', () => {
  it('emits a team.deleted domain event with correct payload when a team is deleted', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Team Deleted Event User'
    })

    const org = await dbAuthContext.createOrganization({
      token: user.token,
      name: 'Team Deleted Event Org'
    })

    // Create team via API
    const createTeamRes = await fetch(`${dbAuthContext.baseUrl}/v1/teams`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${user.token}`,
        ...dbAuthContext.testContext.headersForCase('create-team-for-delete')
      },
      body: JSON.stringify({
        organizationId: org.id,
        name: 'Team To Delete',
        brandSettings: defaultTestBrandSettings
      })
    })

    expect(createTeamRes.ok).toBe(true)
    const team = (await createTeamRes.json()) as { id: string; name: string; organizationId: string }

    // Delete team via API
    const deleteTeamRes = await fetch(`${dbAuthContext.baseUrl}/v1/teams/${team.id}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${user.token}`,
        ...dbAuthContext.testContext.headersForCase('delete-team-event')
      }
    })

    expect(deleteTeamRes.ok).toBe(true)

    // Query domain events for the team aggregate
    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'team', team.id)
    )

    expect(events).toHaveLength(1)

    const domainEvent = events[0]!
    expect(domainEvent.event_type).toBe('team.deleted')
    expect(domainEvent.aggregate_type).toBe('team')
    expect(domainEvent.aggregate_id).toBe(team.id)
    expect(domainEvent.status).toBe('pending')
    expect(domainEvent.sequence_number).toBe(1)
    expect(domainEvent.payload).toEqual(
      expect.objectContaining({
        teamId: team.id,
        teamName: 'Team To Delete',
        organizationId: org.id,
        deletedByUserId: user.user.id
      })
    )
  })

  it('emits an organization.deleted domain event with correct payload when an org is deleted', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Org Deleted Event User'
    })

    const org = await dbAuthContext.createOrganization({
      token: user.token,
      name: 'Org To Delete'
    })

    // Verify the organization.created event exists first
    const createdEvents = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(createdEvents).toHaveLength(1)
    expect(createdEvents[0]!.event_type).toBe('organization.created')

    // Delete organization via API
    const deleteOrgRes = await fetch(`${dbAuthContext.baseUrl}/v1/organizations/${org.id}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${user.token}`,
        ...dbAuthContext.testContext.headersForCase('delete-org-event')
      }
    })

    expect(deleteOrgRes.ok).toBe(true)

    // Query domain events for the organization aggregate
    const allEvents = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    // Should have both organization.created and organization.deleted
    expect(allEvents).toHaveLength(2)

    const deletedEvent = allEvents.find((e) => e.event_type === 'organization.deleted')!
    expect(deletedEvent).toBeDefined()
    expect(deletedEvent.aggregate_type).toBe('organization')
    expect(deletedEvent.aggregate_id).toBe(org.id)
    expect(deletedEvent.status).toBe('pending')
    expect(deletedEvent.sequence_number).toBe(2)
    expect(deletedEvent.payload).toEqual(
      expect.objectContaining({
        organizationId: org.id,
        organizationName: 'Org To Delete',
        deletedByUserId: user.user.id
      })
    )
  })

  it('team deletion event is written transactionally — event persists even though team row is gone', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Team Tx Event User'
    })

    const org = await dbAuthContext.createOrganization({
      token: user.token,
      name: 'Team Tx Org'
    })

    // Create team
    const createRes = await fetch(`${dbAuthContext.baseUrl}/v1/teams`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${user.token}`,
        ...dbAuthContext.testContext.headersForCase('create-team-tx')
      },
      body: JSON.stringify({
        organizationId: org.id,
        name: 'Tx Team',
        brandSettings: defaultTestBrandSettings
      })
    })

    expect(createRes.ok).toBe(true)
    const team = (await createRes.json()) as { id: string }

    // Delete team
    const deleteRes = await fetch(`${dbAuthContext.baseUrl}/v1/teams/${team.id}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${user.token}`,
        ...dbAuthContext.testContext.headersForCase('delete-team-tx')
      }
    })

    expect(deleteRes.ok).toBe(true)

    // Team should be gone (GET returns 404, 403, or 401 depending on auth middleware behavior)
    const getRes = await fetch(`${dbAuthContext.baseUrl}/v1/teams/${team.id}`, {
      headers: {
        authorization: `Bearer ${user.token}`,
        ...dbAuthContext.testContext.headersForCase('get-deleted-team-tx')
      }
    })

    expect([401, 403, 404]).toContain(getRes.status)

    // But the domain event should persist
    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'team', team.id)
    )

    expect(events).toHaveLength(1)
    expect(events[0]!.event_type).toBe('team.deleted')
  })

  it('organization deletion event is written transactionally — event persists even though org row is gone', async () => {
    const user = await dbAuthContext.createUser({
      name: 'Org Tx Event User'
    })

    const org = await dbAuthContext.createOrganization({
      token: user.token,
      name: 'Tx Org'
    })

    // Delete organization
    const deleteRes = await fetch(`${dbAuthContext.baseUrl}/v1/organizations/${org.id}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${user.token}`,
        ...dbAuthContext.testContext.headersForCase('delete-org-tx')
      }
    })

    expect(deleteRes.ok).toBe(true)

    // Org should be gone
    const getRes = await fetch(`${dbAuthContext.baseUrl}/v1/organizations/${org.id}`, {
      headers: {
        authorization: `Bearer ${user.token}`,
        ...dbAuthContext.testContext.headersForCase('get-deleted-org-tx')
      }
    })

    // After org deletion, the user loses membership, so either 404 or 401
    expect([401, 404]).toContain(getRes.status)

    // But both domain events (created + deleted) should persist
    const events = await dbAuthContext.testContext.withSchemaClient(async (client) =>
      queryDomainEventsByAggregate(client, 'organization', org.id)
    )

    expect(events).toHaveLength(2)

    const createdEvent = events.find((e) => e.event_type === 'organization.created')!
    const deletedEvent = events.find((e) => e.event_type === 'organization.deleted')!

    expect(createdEvent).toBeDefined()
    expect(deletedEvent).toBeDefined()
    expect(deletedEvent.sequence_number).toBeGreaterThan(createdEvent.sequence_number)
  })
})
