import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_auto_recharge_requires_action'
})

describe('billing auto-recharge requires_action challenge', () => {
  it('returns the latest pending 3DS challenge for the org', async () => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-3ds-owner-${randomUUID()}@example.com`,
      password: 'billing-3ds-owner-pass-12345',
      name: 'Billing 3DS Owner'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing 3DS Org'
    })

    const olderAttemptId = randomUUID()
    const olderIntentId = `pi_${randomUUID().replaceAll('-', '')}`
    const olderClientSecret = `${olderIntentId}_secret_${randomUUID().replaceAll('-', '')}`
    const newerAttemptId = randomUUID()
    const newerIntentId = `pi_${randomUUID().replaceAll('-', '')}`
    const newerClientSecret = `${newerIntentId}_secret_${randomUUID().replaceAll('-', '')}`

    await factoryContext.testContext.withSchemaClient(async (client) => {
      await client.query(
        `
          INSERT INTO auto_recharge_attempts (
            id,
            organization_id,
            amount_decimillicents,
            status,
            stripe_payment_intent_id,
            failure_reason,
            completed_at,
            created_at
          )
          VALUES
            ($1, $2, $3, 'failed', $4, 'requires user action', now(), now() - interval '5 minutes'),
            ($5, $2, $6, 'failed', $7, 'requires user action', now(), now())
        `,
        [
          olderAttemptId,
          organization.id,
          400_000,
          olderIntentId,
          newerAttemptId,
          900_000,
          newerIntentId
        ]
      )

      await client.query(
        `
          INSERT INTO domain_events (
            event_type,
            aggregate_type,
            aggregate_id,
            payload,
            sequence_number,
            occurred_at
          )
          VALUES
            (
              'billing.recharge_requires_action',
              'billing',
              $1,
              $2::jsonb,
              (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM domain_events WHERE aggregate_id = $1),
              now() - interval '5 minutes'
            ),
            (
              'billing.recharge_requires_action',
              'billing',
              $1,
              $3::jsonb,
              (SELECT COALESCE(MAX(sequence_number), 0) + 2 FROM domain_events WHERE aggregate_id = $1),
              now()
            )
        `,
        [
          organization.id,
          JSON.stringify({
            organizationId: organization.id,
            attemptId: olderAttemptId,
            amountDecimillicents: 400_000,
            stripePaymentIntentId: olderIntentId,
            clientSecret: olderClientSecret
          }),
          JSON.stringify({
            organizationId: organization.id,
            attemptId: newerAttemptId,
            amountDecimillicents: 900_000,
            stripePaymentIntentId: newerIntentId,
            clientSecret: newerClientSecret
          })
        ]
      )
    })

    const result = await request<{
      attemptId: string
      amountDecimillicents: number
      stripePaymentIntentId: string
      clientSecret: string
    } | null>(
      `/v1/billing/${organization.id}/auto-recharge/requires-action`,
      'billing-auto-recharge-requires-action-latest',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${owner.token}` }
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body).toEqual({
      attemptId: newerAttemptId,
      amountDecimillicents: 900_000,
      stripePaymentIntentId: newerIntentId,
      clientSecret: newerClientSecret
    })
  })

  it('returns null when the latest requires_action event belongs to an already-resolved attempt', async () => {
    const factoryContext = getFactoryContext()
    const owner = await createUser(factoryContext, {
      email: `billing-3ds-resolved-owner-${randomUUID()}@example.com`,
      password: 'billing-3ds-resolved-owner-pass-12345',
      name: 'Billing 3DS Resolved Owner'
    })
    const organization = await createOrganization(factoryContext, {
      token: owner.token,
      name: 'Billing 3DS Resolved Org'
    })

    const resolvedAttemptId = randomUUID()
    const stripePaymentIntentId = `pi_${randomUUID().replaceAll('-', '')}`
    const clientSecret = `${stripePaymentIntentId}_secret_${randomUUID().replaceAll('-', '')}`

    await factoryContext.testContext.withSchemaClient(async (client) => {
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
          VALUES ($1, $2, $3, 'succeeded', $4, null, now())
        `,
        [resolvedAttemptId, organization.id, 900_000, stripePaymentIntentId]
      )

      await client.query(
        `
          INSERT INTO domain_events (
            event_type,
            aggregate_type,
            aggregate_id,
            payload,
            sequence_number
          )
          VALUES (
            'billing.recharge_requires_action',
            'billing',
            $1,
            $2::jsonb,
            (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM domain_events WHERE aggregate_id = $1)
          )
        `,
        [
          organization.id,
          JSON.stringify({
            organizationId: organization.id,
            attemptId: resolvedAttemptId,
            amountDecimillicents: 900_000,
            stripePaymentIntentId,
            clientSecret
          })
        ]
      )
    })

    const result = await request<{
      attemptId: string
      amountDecimillicents: number
      stripePaymentIntentId: string
      clientSecret: string
    } | null>(
      `/v1/billing/${organization.id}/auto-recharge/requires-action`,
      'billing-auto-recharge-requires-action-resolved',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${owner.token}` }
      }
    )

    expect(result.response.status).toBe(200)
    expect(result.body).toBeNull()
  })
})
