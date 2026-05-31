import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client as PgClient } from 'pg'
import type { Client as TemporalClient } from '@temporalio/client'
import { getTestkitEnv } from '@tx-agent-kit/testkit'

/**
 * Real-Postgres integration coverage for the outbox dispatcher's LISTEN session:
 * the singleton listener wakes a drain on an external NOTIFY, and recovers
 * (reconnects + resumes draining) after its backend is terminated — the same
 * reconnect path the heartbeat triggers when it detects a half-open connection.
 *
 * Temporal is NOT involved: the drain's outbox I/O is mocked and a fake client
 * is injected, so this isolates the `pg` LISTEN/NOTIFY + reconnect machinery.
 * Local Postgres is a direct (session) connection, so LISTEN works natively.
 */

const {
  fetchUnprocessedEventsMock,
  markEventsPublishedMock,
  markEventFailedMock
} = vi.hoisted(() => ({
  fetchUnprocessedEventsMock: vi.fn(() => Promise.resolve([])),
  markEventsPublishedMock: vi.fn(() => Promise.resolve(undefined)),
  markEventFailedMock: vi.fn(() => Promise.resolve(undefined))
}))

vi.mock('../activities.js', () => ({
  activities: {
    fetchUnprocessedEvents: fetchUnprocessedEventsMock,
    markEventsPublished: markEventsPublishedMock,
    markEventFailed: markEventFailedMock
  }
}))

vi.mock('@tx-agent-kit/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const { startOutboxDispatcher } = await import('./outbox-dispatcher.js')

const NOTIFY_CHANNEL = 'outbox_new_event'
const APP_NAME = 'outbox_listener_itest'
const DB_URL =
  getTestkitEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/tx_agent_kit'
const LISTENER_URL = `${DB_URL}${DB_URL.includes('?') ? '&' : '?'}application_name=${APP_NAME}`

const fakeClient = {
  workflow: { start: vi.fn(() => Promise.resolve(undefined)) }
} as unknown as TemporalClient

const startDispatcher = (): ReturnType<typeof startOutboxDispatcher> =>
  startOutboxDispatcher({
    client: fakeClient,
    defaultTaskQueue: 'test-queue',
    batchSize: 50,
    // Long backstop so any observed drain is attributable to the LISTEN path /
    // reconnect drain-on-connect, never the periodic sweep.
    backstopIntervalSeconds: 3600,
    listenerDatabaseUrl: LISTENER_URL
  })

let control: PgClient
let handle: ReturnType<typeof startOutboxDispatcher> | null = null

beforeAll(async () => {
  control = new PgClient({ connectionString: DB_URL })
  await control.connect()
})

afterAll(async () => {
  await control.end()
})

afterEach(async () => {
  if (handle) {
    await handle.stop()
    handle = null
  }
  vi.clearAllMocks()
})

const notify = async (): Promise<void> => {
  await control.query(`SELECT pg_notify('${NOTIFY_CHANNEL}', '')`)
}

const terminateListenerBackends = async (): Promise<void> => {
  await control.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1',
    [APP_NAME]
  )
}

describe('outbox dispatcher listener (real Postgres)', () => {
  it('wakes a drain when an external NOTIFY arrives', async () => {
    handle = startDispatcher()

    // Listener connects and drains once on connect.
    await vi.waitFor(() => expect(fetchUnprocessedEventsMock).toHaveBeenCalled(), {
      timeout: 10_000
    })

    fetchUnprocessedEventsMock.mockClear()
    await notify()

    await vi.waitFor(() => expect(fetchUnprocessedEventsMock).toHaveBeenCalled(), {
      timeout: 10_000
    })
  }, 30_000)

  it('reconnects after the listener backend is terminated and resumes draining', async () => {
    handle = startDispatcher()

    await vi.waitFor(() => expect(fetchUnprocessedEventsMock).toHaveBeenCalled(), {
      timeout: 10_000
    })

    // Kill the listener's backend — node-postgres raises 'error' → reconnect.
    fetchUnprocessedEventsMock.mockClear()
    await terminateListenerBackends()

    // Reconnect drains-on-connect, proving recovery.
    await vi.waitFor(() => expect(fetchUnprocessedEventsMock).toHaveBeenCalled(), {
      timeout: 15_000
    })

    // And LISTEN works on the fresh connection: a new NOTIFY wakes another drain.
    fetchUnprocessedEventsMock.mockClear()
    await vi.waitFor(
      async () => {
        await notify()
        expect(fetchUnprocessedEventsMock).toHaveBeenCalled()
      },
      { timeout: 15_000, interval: 500 }
    )
  }, 40_000)
})
