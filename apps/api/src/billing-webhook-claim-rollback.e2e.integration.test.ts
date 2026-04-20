import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * processed_stripe_events claim must release on handler failure.
 *
 * The primary idempotency gate for Stripe webhooks is an atomic
 * `INSERT INTO processed_stripe_events ... ON CONFLICT DO NOTHING`
 * that runs BEFORE the state-mutating handler. The historical bug:
 * the claim commits immediately, so if the handler fails afterwards
 * (validation error, transient DB error, fail-closed dispute status)
 * the next Stripe retry hits the existing claim row and silently
 * returns `idempotent: true` — state is never written.
 *
 * This test forces a handler failure via the fail-closed dispute
 * status guard (billing-dispute-outcomes.e2e covers the guard itself)
 * and asserts that:
 *
 *   1. The failed attempt does NOT leave a processed_stripe_events row.
 *   2. A retry with the same event.id is re-processed (not silently
 *      treated as idempotent) — exercising real webhook retry semantics.
 *
 * @spec INV-BILLING-005 — webhook idempotency gate
 * @spec INV-BILLING-009 — fail-closed handler must not strand retries
 */

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_webhook_claim_rollback'
})

describe('webhook claim rollback on handler failure', () => {
  it('releases processed_stripe_events claim when the handler fails, so retries succeed', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `webhook-claim-rollback-${uid}@example.com`,
      password: 'webhook-claim-rollback-pass-12345',
      name: 'Webhook Claim Rollback Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Webhook Claim Rollback Org'
    })

    const customer = `cus_webhook_claim_${uid}`
    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        'UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2',
        [customer, org.id]
      )
    })

    const eventId = `evt_webhook_claim_${uid}`

    // --- Attempt 1: malformed dispute.closed payload, no status field.
    // The fail-closed guard in billing-service.ts rejects with 4xx.
    const badPayload = JSON.stringify({
      id: eventId,
      type: 'charge.dispute.closed',
      data: {
        object: {
          id: `dp_webhook_claim_${uid}`,
          customer,
          amount: 1000
          // status intentionally omitted — hits fail-closed guard
        }
      }
    })

    const firstAttempt = await request<{ message?: string; processed?: boolean }>(
      '/v1/webhooks/stripe',
      'webhook-claim-attempt-1',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: badPayload
      }
    )
    expect(firstAttempt.response.status).toBeGreaterThanOrEqual(400)
    expect(firstAttempt.response.status).toBeLessThan(500)

    // The processed_stripe_events row must NOT have been left behind.
    // If it were, Stripe's retry would see the claim, treat the event
    // as already-processed, and silently drop it.
    const afterFail = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM processed_stripe_events
          WHERE event_id = $1`,
        [eventId]
      )
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(afterFail).toBe(0)

    // --- Attempt 2: Stripe retries. We simulate the retry by POSTing
    // the same event.id again with a WELL-FORMED payload (as if the
    // original malformed payload had been a transient schema glitch).
    // The retry must actually run the handler — not short-circuit
    // as `idempotent: true`.
    const goodPayload = JSON.stringify({
      id: eventId,
      type: 'charge.dispute.closed',
      data: {
        object: {
          id: `dp_webhook_claim_${uid}`,
          customer,
          amount: 1000,
          status: 'won'
        }
      }
    })

    const retry = await request<{ processed: boolean; idempotent: boolean }>(
      '/v1/webhooks/stripe',
      'webhook-claim-attempt-2',
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: goodPayload
      }
    )
    expect(retry.response.status).toBe(200)
    expect(retry.body.processed).toBe(true)
    expect(retry.body.idempotent).toBe(false) // ← the whole point

    // And now the claim row should exist (retry committed).
    const afterRetry = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM processed_stripe_events
          WHERE event_id = $1`,
        [eventId]
      )
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(afterRetry).toBe(1)
  })
})
