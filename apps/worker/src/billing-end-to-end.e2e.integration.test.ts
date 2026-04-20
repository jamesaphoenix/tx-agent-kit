import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'
import { Effect, Option } from 'effect'
import { getPool, organizationsRepository } from '@tx-agent-kit/db'
import {
  buildSerializedDomainEvent as buildTestSerializedDomainEvent,
  cleanupBillingOrganizations,
  expectNotificationForOutboxEventWithClient,
  seedBillingOrganization
} from '@tx-agent-kit/testkit'
import {
  getWorkerEnv,
  resetWorkerEnvCache,
  resolveWorkerTemporalConnectionOptions
} from './config/env.js'
import { combinedActivities, type SerializedDomainEvent } from './activities.js'

// getWorkerEnv() requires DATABASE_URL. Pass a literal default local
// postgres URL via vi.stubEnv so env validation passes at test boot. The
// integration runner (run-temporal-integration.sh) sources .env first so
// the real worktree-scoped URL overrides this stub when running through
// the normal pipeline. Worker rule `no-restricted-syntax` forbids reading
// env vars outside config/env.ts so a literal is used here rather than
// a `process.env.DATABASE_URL ?? …` fallback.
vi.stubEnv(
  'DATABASE_URL',
  'postgresql://postgres:postgres@localhost:5432/tx_agent_kit'
)
resetWorkerEnvCache()

/**
 * End-to-end integration test for the billing worker dispatch path.
 *
 * Boots a real Temporal worker against the local dev server, dispatches the
 * per-event workflows directly via the Temporal client (mirroring what the
 * outbox poller would do at runtime), and asserts the side effects landed
 * in Postgres.
 *
 * Stripe is the only stubbed dependency — the worker-side StripePort
 * resolves to a `pi_local_*` no-op when `STRIPE_SECRET_KEY` is unset.
 *
 * @spec billing-and-pricing-design
 */

let temporalConnection: NativeConnection | undefined
let workflowClient: Client | undefined
let workflowWorker: Worker | undefined
let workflowWorkerRunPromise: Promise<void> | undefined
let workflowTaskQueue: string | undefined

const cleanupOrgIds: string[] = []
const cleanupUserIds: string[] = []

const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

const seedTestOrg = async (overrides: { creditsBalance?: number } = {}): Promise<{
  orgId: string
  userId: string
}> => {
  const { orgId, userId } = await seedBillingOrganization(getPool(), {
    prefix: 'billing-e2e',
    creditsBalance: overrides.creditsBalance ?? 0
  })
  cleanupOrgIds.push(orgId)
  cleanupUserIds.push(userId)
  return { orgId, userId }
}

const buildSerializedDomainEvent = (input: {
  eventType: string
  aggregateId: string
  payload: Record<string, unknown>
}): SerializedDomainEvent => {
  return buildTestSerializedDomainEvent({
    eventType: input.eventType,
    aggregateId: input.aggregateId,
    payload: input.payload
  })
}

const expectNotificationForEvent = async (input: {
  orgId: string
  userId: string
  event: SerializedDomainEvent
}): Promise<void> => {
  const client = await getPool().connect()
  try {
    await expectNotificationForOutboxEventWithClient(client, {
      organizationId: input.orgId,
      userId: input.userId,
      outboxEventId: input.event.id,
      eventType: input.event.eventType
    })
  } finally {
    client.release()
  }
}

beforeAll(async () => {
  const workerEnv = getWorkerEnv()

  temporalConnection = await NativeConnection.connect(
    resolveWorkerTemporalConnectionOptions(workerEnv)
  )
  workflowClient = new Client({
    connection: temporalConnection,
    namespace: workerEnv.TEMPORAL_NAMESPACE
  })

  workflowTaskQueue = `tx-agent-kit-billing-e2e-${randomUUID()}`
  const sourceDir = dirname(fileURLToPath(import.meta.url))

  workflowWorker = await Worker.create({
    connection: temporalConnection,
    namespace: workerEnv.TEMPORAL_NAMESPACE,
    taskQueue: workflowTaskQueue,
    workflowsPath: resolve(sourceDir, 'workflows.ts'),
    activities: combinedActivities
  })
  workflowWorkerRunPromise = workflowWorker.run()
}, 60_000)

afterAll(async () => {
  if (workflowWorker) {
    workflowWorker.shutdown()
  }
  if (workflowWorkerRunPromise) {
    await workflowWorkerRunPromise
  }
  if (temporalConnection) {
    await temporalConnection.close()
  }
}, 30_000)

afterEach(async () => {
  await cleanupBillingOrganizations(getPool(), {
    organizationIds: cleanupOrgIds,
    userIds: cleanupUserIds
  })
  cleanupOrgIds.length = 0
  cleanupUserIds.length = 0
})

const getClient = (): Client => {
  if (!workflowClient) {
    throw new Error('Workflow client not initialized')
  }
  return workflowClient
}

const getQueue = (): string => {
  if (!workflowTaskQueue) {
    throw new Error('Workflow task queue not initialized')
  }
  return workflowTaskQueue
}

describe('billing worker end-to-end (Temporal)', () => {
  // @spec billing-and-pricing-design §"Usage Cap System"
  it(
    'usageCapExceededWorkflow → applyUsageCapExceeded sets organizations.suspended_at',
    async () => {
      const { orgId, userId } = await seedTestOrg({ creditsBalance: 0 })

      const event = buildSerializedDomainEvent({
        eventType: 'billing.usage_cap_exceeded',
        aggregateId: orgId,
        payload: { organizationId: orgId, capDecimillicents: 100_000_000 }
      })

      const handle = await getClient().workflow.start('usageCapExceededWorkflow', {
        taskQueue: getQueue(),
        workflowId: `usageCapExceeded-${event.id}`,
        args: [event]
      })
      await handle.result()

      const org = await runEffect(organizationsRepository.getById(orgId))
      if (Option.isNone(org)) {
        throw new Error(`org ${orgId} not found after workflow`)
      }
      expect(org.value.suspendedAt).toBeInstanceOf(Date)
      await expectNotificationForEvent({ orgId, userId, event })
    },
    120_000
  )

  // @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
  it(
    'creditsPurchasedWorkflow → creditPositiveReevaluate clears suspended_at after a top-up',
    async () => {
      const { orgId, userId } = await seedTestOrg({ creditsBalance: 0 })

      // First suspend the org via a usage cap exceeded workflow, then top up
      // the balance and dispatch a credits_purchased workflow. The
      // credit-positive consumer should observe the positive available
      // balance and clear suspendedAt.
      await getClient()
        .workflow.start('usageCapExceededWorkflow', {
          taskQueue: getQueue(),
          workflowId: `usageCapExceeded-${randomUUID()}`,
          args: [
            buildSerializedDomainEvent({
              eventType: 'billing.usage_cap_exceeded',
              aggregateId: orgId,
              payload: { organizationId: orgId, capDecimillicents: 100_000_000 }
            })
          ]
        })
        .then((h) => h.result())

      // Top-up the balance via raw SQL — bypass the credit ledger trigger
      // contracts so the test is decoupled from the purchase-handling
      // workflow that this test does not exercise.
      const sqlClient = await getPool().connect()
      try {
        await sqlClient.query(
          `UPDATE organizations SET credits_balance = $1 WHERE id = $2`,
          [1_000_000, orgId]
        )
      } finally {
        sqlClient.release()
      }

      const purchaseEvent = buildSerializedDomainEvent({
        eventType: 'billing.credits_purchased',
        aggregateId: orgId,
        payload: { organizationId: orgId, amountDecimillicents: 1_000_000 }
      })
      await getClient()
        .workflow.start('creditsPurchasedWorkflow', {
          taskQueue: getQueue(),
          workflowId: `creditsPurchased-${purchaseEvent.id}`,
          args: [purchaseEvent]
        })
        .then((h) => h.result())

      const org = await runEffect(organizationsRepository.getById(orgId))
      if (Option.isNone(org)) {
        throw new Error(`org ${orgId} not found after credit-positive re-evaluation`)
      }
      expect(org.value.suspendedAt).toBeNull()
      await expectNotificationForEvent({ orgId, userId, event: purchaseEvent })
    },
    180_000
  )

  // @spec billing-and-pricing-design §"Payment Grace Period"
  it(
    'paymentFailedWorkflow → startPaymentGracePeriod sets organizations.payment_grace_period_ends_at',
    async () => {
      const { orgId, userId } = await seedTestOrg()

      const event = buildSerializedDomainEvent({
        eventType: 'billing.payment_failed',
        aggregateId: orgId,
        payload: { organizationId: orgId }
      })

      const handle = await getClient().workflow.start('paymentFailedWorkflow', {
        taskQueue: getQueue(),
        workflowId: `paymentFailed-${event.id}`,
        args: [event]
      })
      await handle.result()

      const org = await runEffect(organizationsRepository.getById(orgId))
      if (Option.isNone(org)) {
        throw new Error(`org ${orgId} not found after payment failed workflow`)
      }
      expect(org.value.paymentGracePeriodEndsAt).toBeInstanceOf(Date)
      await expectNotificationForEvent({ orgId, userId, event })
    },
    120_000
  )
})
