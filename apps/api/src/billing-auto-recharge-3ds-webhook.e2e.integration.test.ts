import {
  AutoRechargeAttemptStorePortLive,
  BillingService,
  BillingServiceLive,
  BillingStorePortLive,
  ClockPortLive,
  CoreError,
  CreditLedgerStorePortLive,
  CreditServicePort,
  ProcessedStripeEventStorePortLive,
  StaleReservationReaderPortLive,
  StripePort,
  SubscriptionEventStorePortLive,
  makeCreditService,
  type BillingService as BillingServiceTag,
  type BillingStorePort,
  type CreditLedgerStorePort
} from '@tx-agent-kit/core'
import { AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS } from '@tx-agent-kit/contracts'
import { resetPool } from '@tx-agent-kit/db'
import { Effect, Either, Layer } from 'effect'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const savedEnvValues = {
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY
}
process.env.R2_ACCESS_KEY_ID ??= 'test-r2-access-key-id'
process.env.R2_SECRET_ACCESS_KEY ??= 'test-r2-secret-access-key'

const { dbAuthContext } = createTestFixture({
  schemaPrefix: 'billing_auto_recharge_3ds_webhook',
  autoRegisterHooks: false
})

const buildStripeWebhookPort = (input: {
  eventId: string
  organizationId: string
  attemptId: string
  stripePaymentIntentId: string
  amountReceivedCents: number
}) =>
  Layer.succeed(StripePort, {
    createCheckoutSession: () => Effect.fail(new Error('not used in this test')),
    createPortalSession: () => Effect.fail(new Error('not used in this test')),
    createTopUpSession: () => Effect.fail(new Error('not used in this test')),
    constructWebhookEvent: () =>
      Effect.succeed({
        id: input.eventId,
        type: 'payment_intent.succeeded',
        payload: {
          id: input.eventId,
          type: 'payment_intent.succeeded'
        },
        data: {
          object: {
            id: input.stripePaymentIntentId,
            amount_received: input.amountReceivedCents,
            metadata: {
              organizationId: input.organizationId,
              autoRechargeAttemptId: input.attemptId
            }
          },
          previousAttributes: null
        }
      }),
    createCustomer: () => Effect.fail(new Error('not used in this test')),
    createOffSessionPaymentIntent: () => Effect.fail(new Error('not used in this test')),
    resolvePlanFromPriceIds: () => 'pro' as const
  })

const CreditServicePortLive = Layer.effect(CreditServicePort, makeCreditService)

const unusedCreditMethod = (label: string) =>
  Effect.fail(new CoreError({ code: 'BAD_REQUEST', message: `not used in test: ${label}` }))

const CreditServicePortFailingRecharge = Layer.succeed(CreditServicePort, {
  reserve: () => unusedCreditMethod('reserve'),
  finalize: () => unusedCreditMethod('finalize'),
  release: () => unusedCreditMethod('release'),
  getAvailableBalance: () => unusedCreditMethod('getAvailableBalance'),
  creditsPurchased: () => unusedCreditMethod('creditsPurchased'),
  creditsRecharged: () =>
    Effect.fail(new CoreError({ code: 'BAD_REQUEST', message: 'simulated credit ledger commit failure' })),
  releaseStaleReservations: () => unusedCreditMethod('releaseStaleReservations')
})

const buildServiceDeps = (
  stripePortLive: Layer.Layer<StripePort>,
  creditServiceLive: Layer.Layer<CreditServicePort, never, BillingStorePort | CreditLedgerStorePort> = CreditServicePortLive
) => {
  const portDeps = Layer.mergeAll(
    BillingStorePortLive,
    CreditLedgerStorePortLive,
    AutoRechargeAttemptStorePortLive,
    ProcessedStripeEventStorePortLive,
    SubscriptionEventStorePortLive,
    ClockPortLive,
    StaleReservationReaderPortLive,
    stripePortLive
  )

  const serviceDeps = Layer.mergeAll(
    BillingServiceLive,
    creditServiceLive
  ).pipe(Layer.provide(portDeps))

  return Layer.mergeAll(portDeps, serviceDeps)
}

type BillingServiceImpl = Effect.Effect.Success<typeof BillingServiceTag>

beforeAll(async () => {
  await dbAuthContext.setup()
})

beforeEach(async () => {
  await dbAuthContext.reset()
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

describe('auto-recharge 3DS webhook completion', () => {
  it('rejects oversized payment_intent.succeeded amounts before wallet crediting', async () => {
    const owner = await dbAuthContext.createUser({
      email: `billing-3ds-webhook-oversized-${randomUUID()}@example.com`,
      password: 'billing-3ds-webhook-owner-pass-12345',
      name: 'Billing 3DS Webhook Oversized Owner'
    })
    const organization = await dbAuthContext.createOrganization({
      token: owner.token,
      name: 'Billing 3DS Webhook Oversized Org'
    })

    const attemptId = randomUUID()
    const stripePaymentIntentId = `pi_${randomUUID().replaceAll('-', '')}`
    const stripeEventId = `evt_${randomUUID().replaceAll('-', '')}`
    const amountDecimillicents = 900_000

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO auto_recharge_attempts (
            id,
            organization_id,
            amount_decimillicents,
            status,
            stripe_payment_intent_id,
            failure_reason,
            completed_at
          )
          VALUES ($1, $2, $3, 'failed', $4, 'requires user action', now())
        `,
        [attemptId, organization.id, amountDecimillicents, stripePaymentIntentId]
      )
    })

    await resetPool()

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service: BillingServiceImpl = yield* BillingService
        return yield* service.processWebhookEvent('{}', 'stripe-signature')
      }).pipe(
        Effect.provide(
          buildServiceDeps(
            buildStripeWebhookPort({
              eventId: stripeEventId,
              organizationId: organization.id,
              attemptId,
              stripePaymentIntentId,
              amountReceivedCents: (AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS / 100_000) + 1
            })
          )
        ),
        Effect.either
      )
    ).finally(async () => {
      await resetPool()
    })

    expect(Either.isLeft(outcome)).toBe(true)

    const snapshot = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const attemptResult = await client.query<{
        status: string
        failure_reason: string | null
        stripe_payment_intent_id: string | null
      }>(
        `
          SELECT status, failure_reason, stripe_payment_intent_id
            FROM auto_recharge_attempts
           WHERE id = $1
        `,
        [attemptId]
      )
      const ledgerResult = await client.query<{ count: string }>(
        `
          SELECT count(*)::text
            FROM credit_ledger
           WHERE organization_id = $1
             AND entry_type = 'auto_recharge'
        `,
        [organization.id]
      )
      const claimResult = await client.query<{ count: string }>(
        `
          SELECT count(*)::text
            FROM processed_stripe_events
           WHERE event_id = $1
        `,
        [stripeEventId]
      )

      return {
        attempt: attemptResult.rows[0] ?? null,
        ledgerCount: Number.parseInt(ledgerResult.rows[0]?.count ?? '0', 10),
        claimCount: Number.parseInt(claimResult.rows[0]?.count ?? '0', 10)
      }
    })

    expect(snapshot.attempt).toMatchObject({
      status: 'failed',
      failure_reason: 'requires user action',
      stripe_payment_intent_id: stripePaymentIntentId
    })
    expect(snapshot.ledgerCount).toBe(0)
    expect(snapshot.claimCount).toBe(0)
  })

  it('payment_intent.succeeded credits the org and clears the requires_action attempt', async () => {
    const owner = await dbAuthContext.createUser({
      email: `billing-3ds-webhook-owner-${randomUUID()}@example.com`,
      password: 'billing-3ds-webhook-owner-pass-12345',
      name: 'Billing 3DS Webhook Owner'
    })
    const organization = await dbAuthContext.createOrganization({
      token: owner.token,
      name: 'Billing 3DS Webhook Org'
    })

    const attemptId = randomUUID()
    const stripePaymentIntentId = `pi_${randomUUID().replaceAll('-', '')}`
    const stripeEventId = `evt_${randomUUID().replaceAll('-', '')}`
    const amountDecimillicents = 900_000

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO auto_recharge_attempts (
            id,
            organization_id,
            amount_decimillicents,
            status,
            stripe_payment_intent_id,
            failure_reason,
            completed_at
          )
          VALUES ($1, $2, $3, 'failed', $4, 'requires user action', now())
        `,
        [attemptId, organization.id, amountDecimillicents, stripePaymentIntentId]
      )
    })

    const originalDatabaseUrl = process.env.DATABASE_URL
    const originalPgOptions = process.env.PGOPTIONS
    process.env.DATABASE_URL = dbAuthContext.testContext.baseDatabaseUrl
    process.env.PGOPTIONS = `-csearch_path=${dbAuthContext.testContext.schemaName},public`
    await resetPool()

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service: BillingServiceImpl = yield* BillingService
        return yield* service.processWebhookEvent('{}', 'stripe-signature')
      }).pipe(
        Effect.provide(
          buildServiceDeps(
            buildStripeWebhookPort({
              eventId: stripeEventId,
              organizationId: organization.id,
              attemptId,
              stripePaymentIntentId,
              amountReceivedCents: 9
            })
          )
        ),
        Effect.either
      )
    ).finally(async () => {
      await resetPool()
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl
      }
      if (originalPgOptions === undefined) {
        delete process.env.PGOPTIONS
      } else {
        process.env.PGOPTIONS = originalPgOptions
      }
    })

    expect(Either.isRight(outcome)).toBe(true)

    const snapshot = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const attemptResult = await client.query<{
        status: string
        failure_reason: string | null
        stripe_payment_intent_id: string | null
      }>(
        `
          SELECT status, failure_reason, stripe_payment_intent_id
            FROM auto_recharge_attempts
           WHERE id = $1
        `,
        [attemptId]
      )
      const ledgerResult = await client.query<{
        entry_type: string
        amount_decimillicents: string
        reference_id: string | null
      }>(
        `
          SELECT entry_type, amount_decimillicents::text, reference_id
            FROM credit_ledger
           WHERE organization_id = $1
             AND entry_type = 'auto_recharge'
        `,
        [organization.id]
      )

      return {
        attempt: attemptResult.rows[0] ?? null,
        ledgerRows: ledgerResult.rows
      }
    })

    expect(snapshot.attempt).toMatchObject({
      status: 'succeeded',
      failure_reason: null,
      stripe_payment_intent_id: stripePaymentIntentId
    })
    expect(snapshot.ledgerRows).toEqual([
      {
        entry_type: 'auto_recharge',
        amount_decimillicents: String(amountDecimillicents),
        reference_id: `stripe:auto-recharge:${attemptId}`
      }
    ])
  })

  it('keeps the attempt retryable when wallet crediting fails after Stripe success', async () => {
    const owner = await dbAuthContext.createUser({
      email: `billing-3ds-webhook-credit-fails-${randomUUID()}@example.com`,
      password: 'billing-3ds-webhook-owner-pass-12345',
      name: 'Billing 3DS Webhook Credit Failure Owner'
    })
    const organization = await dbAuthContext.createOrganization({
      token: owner.token,
      name: 'Billing 3DS Webhook Credit Failure Org'
    })

    const attemptId = randomUUID()
    const stripePaymentIntentId = `pi_${randomUUID().replaceAll('-', '')}`
    const stripeEventId = `evt_${randomUUID().replaceAll('-', '')}`
    const amountDecimillicents = 900_000

    await dbAuthContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO auto_recharge_attempts (
            id,
            organization_id,
            amount_decimillicents,
            status,
            stripe_payment_intent_id,
            failure_reason,
            completed_at
          )
          VALUES ($1, $2, $3, 'failed', $4, 'requires user action', now())
        `,
        [attemptId, organization.id, amountDecimillicents, stripePaymentIntentId]
      )
    })

    await resetPool()

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service: BillingServiceImpl = yield* BillingService
        return yield* service.processWebhookEvent('{}', 'stripe-signature')
      }).pipe(
        Effect.provide(
          buildServiceDeps(
            buildStripeWebhookPort({
              eventId: stripeEventId,
              organizationId: organization.id,
              attemptId,
              stripePaymentIntentId,
              amountReceivedCents: 9
            }),
            CreditServicePortFailingRecharge
          )
        ),
        Effect.either
      )
    ).finally(async () => {
      await resetPool()
    })

    expect(Either.isLeft(outcome)).toBe(true)

    const snapshot = await dbAuthContext.testContext.withSchemaClient(async (client) => {
      const attemptResult = await client.query<{
        status: string
        failure_reason: string | null
        stripe_payment_intent_id: string | null
      }>(
        `
          SELECT status, failure_reason, stripe_payment_intent_id
            FROM auto_recharge_attempts
           WHERE id = $1
        `,
        [attemptId]
      )
      const ledgerResult = await client.query<{ count: string }>(
        `
          SELECT count(*)::text
            FROM credit_ledger
           WHERE organization_id = $1
             AND entry_type = 'auto_recharge'
        `,
        [organization.id]
      )
      const claimResult = await client.query<{ count: string }>(
        `
          SELECT count(*)::text
            FROM processed_stripe_events
           WHERE event_id = $1
        `,
        [stripeEventId]
      )

      return {
        attempt: attemptResult.rows[0] ?? null,
        ledgerCount: Number.parseInt(ledgerResult.rows[0]?.count ?? '0', 10),
        claimCount: Number.parseInt(claimResult.rows[0]?.count ?? '0', 10)
      }
    })

    expect(snapshot.attempt).toMatchObject({
      status: 'failed',
      failure_reason: 'requires user action',
      stripe_payment_intent_id: stripePaymentIntentId
    })
    expect(snapshot.ledgerCount).toBe(0)
    expect(snapshot.claimCount).toBe(0)
  })
})
