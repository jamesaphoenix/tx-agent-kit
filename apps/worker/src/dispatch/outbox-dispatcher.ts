import type { Client as TemporalClient } from '@temporalio/client'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common'
import { Client as PgClient } from 'pg'
import { createLogger } from '@tx-agent-kit/logging'
import {
  recordOutboxBatchDispatched,
  recordOutboxBatchFill,
  recordOutboxListenerConnected
} from '@tx-agent-kit/observability'
import type { SerializedDomainEvent } from '../activities.js'
import { activities } from '../activities.js'
import { captureWorkerException } from '../observability/sentry.js'
import { resolveDispatch } from './resolve-dispatch.js'

// The dispatcher runs in plain Node (no Temporal determinism sandbox), so it
// invokes these outbox I/O functions directly rather than through activity
// proxies. They do plain DB IO — no activity context.
const {
  fetchUnprocessedEvents,
  markEventFailed,
  markEventsPublished,
  measureOutboxBacklog
} = activities

const logger = createLogger('tx-agent-kit-worker-outbox-dispatcher')

const NOTIFY_CHANNEL = 'outbox_new_event'
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000
// Detects a silently-dead (half-open) listener connection that never fires an
// 'error' event, and keeps the pooler from idle-timing-out the session.
const HEARTBEAT_INTERVAL_MS = 30_000

export interface OutboxDispatcherOptions {
  readonly client: TemporalClient
  /** Task queue used when a dispatch plan does not pin its own. */
  readonly defaultTaskQueue: string
  readonly batchSize: number
  readonly backstopIntervalSeconds: number
  /**
   * Postgres connection string for the LISTEN session. MUST be a direct /
   * session-mode connection (e.g. Supabase 5432), never a transaction pooler —
   * LISTEN state is per-session and is broken by transaction pooling.
   */
  readonly listenerDatabaseUrl: string
}

export interface OutboxDispatcherHandle {
  /** Run a coalesced drain pass now (used on connect, by the backstop, and tests). */
  readonly drain: () => Promise<void>
  readonly stop: () => Promise<void>
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Drain the outbox to empty in one pass: claim a batch (FOR UPDATE SKIP LOCKED),
 * start one workflow per event, mark the batch published, and repeat until a
 * partial/empty batch signals the queue is drained. Safe to run concurrently
 * across replicas — SKIP LOCKED gives each a disjoint set and REJECT_DUPLICATE
 * is a second idempotency guard keyed by the deterministic workflowId.
 */
export const drainOutboxOnce = async (
  client: TemporalClient,
  defaultTaskQueue: string,
  batchSize: number
): Promise<void> => {
  for (;;) {
    const events = await fetchUnprocessedEvents(batchSize)
    if (events.length === 0) {
      return
    }

    const dispatched: SerializedDomainEvent[] = []

    for (const event of events) {
      const plan = resolveDispatch(event)

      if (plan.kind === 'invalid') {
        await markEventFailed(event.id, plan.reason)
        continue
      }

      try {
        await client.workflow.start(plan.workflowType, {
          workflowId: plan.workflowId,
          taskQueue: plan.taskQueue ?? defaultTaskQueue,
          args: [...plan.args],
          workflowIdReusePolicy: 'REJECT_DUPLICATE',
          workflowRunTimeout: plan.workflowRunTimeout
        })
        dispatched.push(event)
      } catch (error: unknown) {
        if (error instanceof WorkflowExecutionAlreadyStartedError) {
          // A concurrent replica (or an earlier crashed pass) already started
          // it — the deterministic workflowId makes start idempotent.
          dispatched.push(event)
        } else {
          // Treat any other start failure as TRANSIENT (Temporal briefly
          // unreachable, task-queue hiccup). Do NOT terminal-fail: leave the row
          // claimed ('processing') so the stuck-events-reset schedule returns it
          // to 'pending' for retry. Only structurally-invalid events (the
          // resolveDispatch 'invalid' branch above) are permanently failed, since
          // they can never succeed. A poison event that always fails to start is
          // bounded by the stuck-reset cadence and surfaced by the outbox age
          // alert (proper attempt-capped backoff + dead-letter is a follow-up).
          logger.error('Failed to start workflow for outbox event; leaving claimed for retry.', {
            eventId: event.id,
            eventType: event.eventType,
            error: errorMessage(error)
          })
        }
      }
    }

    if (dispatched.length > 0) {
      await markEventsPublished(dispatched.map((event) => event.id))
      recordOutboxBatchDispatched(dispatched.length)
      recordOutboxBatchFill(dispatched.length, batchSize)
    }

    if (events.length < batchSize) {
      return
    }
  }
}

/**
 * Wrap an async task so it is single-flight: while a run is in progress further
 * triggers set a "dirty" flag and the run repeats once more on completion,
 * coalescing a burst of NOTIFYs into the minimum number of drain passes.
 */
const createSingleFlight = (run: () => Promise<void>): (() => Promise<void>) => {
  let running = false
  let pending = false

  // Kept in a nested function so `pending` reads as a captured (mutable-from-
  // elsewhere) boolean rather than a flow-narrowed literal — a reentrant
  // trigger() flips it back on between passes.
  const drainUntilSettled = async (): Promise<void> => {
    while (pending) {
      pending = false
      await run()
    }
  }

  return async () => {
    pending = true
    if (running) {
      return
    }
    running = true
    try {
      await drainUntilSettled()
    } finally {
      running = false
    }
  }
}

/**
 * Start the event-driven outbox dispatcher: a Postgres LISTEN session wakes a
 * coalesced drain on every committed insert, and a low-frequency backstop timer
 * catches any missed notification.
 */
export function startOutboxDispatcher(
  options: OutboxDispatcherOptions
): OutboxDispatcherHandle {
  const { client, defaultTaskQueue, batchSize, backstopIntervalSeconds, listenerDatabaseUrl } = options

  const trigger = createSingleFlight(async () => {
    try {
      await drainOutboxOnce(client, defaultTaskQueue, batchSize)
    } catch (error: unknown) {
      logger.error('Outbox drain pass failed.', { error: errorMessage(error) })
    }
  })

  let stopped = false
  let listener: PgClient | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let reconnectAttempts = 0
  let listenerConnected = false

  const setListenerConnected = (connected: boolean): void => {
    listenerConnected = connected
    recordOutboxListenerConnected(connected)
  }

  // Capped exponential backoff with full jitter, so a fleet of workers doesn't
  // reconnect in lockstep and stampede the pooler while it's recovering.
  const nextReconnectDelayMs = (): number => {
    const ceiling = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_DELAY_MS
    )
    reconnectAttempts += 1
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2))
  }

  const teardownListener = async (): Promise<void> => {
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
    const current = listener
    listener = null
    if (current) {
      current.removeAllListeners()
      try {
        await current.end()
      } catch {
        // Best-effort close; a failed end() on an already-broken connection is
        // not actionable — reconnect/stop proceeds regardless.
      }
    }
  }

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer) {
      return
    }
    setListenerConnected(false)
    void teardownListener()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, nextReconnectDelayMs())
    reconnectTimer.unref()
  }

  const connect = async (): Promise<void> => {
    if (stopped) {
      return
    }

    const pg = new PgClient({ connectionString: listenerDatabaseUrl, keepAlive: true })
    listener = pg
    pg.on('error', (error: Error) => {
      logger.error('Outbox listener connection error; reconnecting.', { error: error.message })
      // The dispatcher self-heals via scheduleReconnect, but the failure must still
      // surface in Sentry rather than only in logs.
      captureWorkerException(error)
      scheduleReconnect()
    })
    pg.on('notification', () => {
      void trigger()
    })

    try {
      await pg.connect()
      await pg.query(`LISTEN ${NOTIFY_CHANNEL}`)
      reconnectAttempts = 0
      setListenerConnected(true)
      logger.info('Outbox listener connected.', { channel: NOTIFY_CHANNEL })

      // Liveness probe: a query on the listener detects a half-open connection
      // that never raised 'error', and triggers a reconnect.
      heartbeat = setInterval(() => {
        void (async () => {
          try {
            await pg.query('SELECT 1')
          } catch (error: unknown) {
            logger.error('Outbox listener heartbeat failed; reconnecting.', { error: errorMessage(error) })
            scheduleReconnect()
          }
        })()
      }, HEARTBEAT_INTERVAL_MS)
      heartbeat.unref()

      // Cover events written while we were disconnected.
      void trigger()
    } catch (error: unknown) {
      logger.error('Outbox listener failed to connect; retrying.', { error: errorMessage(error) })
      setListenerConnected(false)
      scheduleReconnect()
    }
  }

  void connect()

  const backstop = setInterval(() => {
    // Re-emit the listener health gauge each tick so a flatlined series (no
    // recent samples) is itself an alertable signal, then catch any missed
    // NOTIFY and refresh the lock-free backlog gauges from true pending depth.
    recordOutboxListenerConnected(listenerConnected)
    void trigger()
    void (async () => {
      try {
        await measureOutboxBacklog()
      } catch (error: unknown) {
        logger.error('Outbox backlog measurement failed.', { error: errorMessage(error) })
      }
    })()
  }, backstopIntervalSeconds * 1000)
  backstop.unref()

  return {
    drain: trigger,
    stop: async () => {
      stopped = true
      clearInterval(backstop)
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      await teardownListener()
    }
  }
}
