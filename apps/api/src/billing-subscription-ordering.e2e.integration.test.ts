import { randomUUID } from 'node:crypto'
import { createOrganization, createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * Stripe webhook ordering tolerance for the subscription state machine.
 *
 * Stripe guarantees at-least-once delivery and retries on failure, which
 * means events can arrive out of order — a `customer.subscription.updated`
 * with status=active from before the cancellation can land AFTER the
 * `customer.subscription.deleted` that set the sub to canceled. The
 * billing service must not resurrect a canceled subscription when a
 * stale `.updated` arrives late.
 *
 * `invoice.payment_succeeded → no resurrect` is already covered in
 * billing.integration.test.ts. This file pins the matching behavior for
 * the subscription.updated path.
 *
 * @spec billing-and-pricing-design §"Subscription lifecycle"
 */

const uid = randomUUID().slice(0, 8)

const { request, getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_subscription_ordering'
})

describe('subscription webhook ordering tolerance', () => {
  // @spec INV-BILLING-005
  it.each([
    ['customer.subscription.created', 'active'],
    ['customer.subscription.updated', 'active'],
    ['customer.subscription.deleted', 'canceled']
  ])('%s without a subscription id fails closed without mutating subscription state', async (eventType, status) => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `sub-missing-id-${eventType.replaceAll('.', '-')}-${uid}@example.com`,
      password: 'sub-missing-id-pass-12345',
      name: 'Subscription Missing Id Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: `Subscription Missing Id ${eventType} Org`
    })

    const customerId = `cus_sub_missing_id_${randomUUID().slice(0, 8)}`
    const activeSubId = `sub_missing_id_active_${randomUUID().slice(0, 8)}`
    if (eventType !== 'customer.subscription.created') {
      await ctx.testContext.withSchemaClient(async (client) => {
        await client.query(
          `UPDATE organizations
              SET stripe_customer_id = $1,
                  stripe_subscription_id = $2,
                  subscription_plan = 'pro',
                  subscription_status = 'active',
                  is_subscribed = true
            WHERE id = $3`,
          [customerId, activeSubId, org.id]
        )
      })
    }

    const eventId = `evt_sub_missing_id_${randomUUID().slice(0, 8)}`
    const outcome = await request<{ message?: string }>(
      '/v1/webhooks/stripe',
      `sub-missing-id-${eventType}`,
      {
        method: 'POST',
        headers: { 'stripe-signature': 'integration-signature' },
        body: JSON.stringify({
          id: eventId,
          type: eventType,
          data: {
            object: {
              customer: customerId,
              status,
              current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
              metadata: {
                organizationId: org.id,
                subscriptionPlan: 'agency'
              }
            }
          }
        })
      }
    )

    expect(outcome.response.status).toBeGreaterThanOrEqual(400)
    expect(outcome.response.status).toBeLessThan(500)

    await ctx.testContext.withSchemaClient(async (client) => {
      const claim = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM processed_stripe_events WHERE event_id = $1',
        [eventId]
      )
      expect(Number.parseInt(claim.rows[0]?.count ?? '0', 10)).toBe(0)

      const orgRow = await client.query<{
        stripe_subscription_id: string | null
        subscription_status: string
        subscription_plan: string | null
        is_subscribed: boolean
      }>(
        `SELECT
           stripe_subscription_id,
           subscription_status,
           subscription_plan,
           is_subscribed
         FROM organizations
         WHERE id = $1`,
        [org.id]
      )

      if (eventType === 'customer.subscription.created') {
        expect(orgRow.rows[0]).toMatchObject({
          stripe_subscription_id: null,
          subscription_status: 'inactive',
          subscription_plan: null,
          is_subscribed: false
        })
      } else {
        expect(orgRow.rows[0]).toMatchObject({
          stripe_subscription_id: activeSubId,
          subscription_status: 'active',
          subscription_plan: 'pro',
          is_subscribed: true
        })
      }
    })
  })

  // @spec billing-and-pricing-design §"Subscription lifecycle"
  it('customer.subscription.deleted for an OLD subscription id does NOT wipe out a newer active sub', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `sub-delete-stale-${uid}@example.com`,
      password: 'sub-delete-stale-pass-12345',
      name: 'Subscription Delete Stale Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Subscription Delete Stale Org'
    })

    const customerId = `cus_delete_stale_${uid}`
    const oldSubId = `sub_delete_stale_old_${uid}`
    const newSubId = `sub_delete_stale_new_${uid}`

    // Pre-link the org to the customer + newer subscription via a
    // customer.subscription.created webhook.
    const createPayload = {
      id: `evt_sub_new_created_${uid}`,
      type: 'customer.subscription.created',
      data: {
        object: {
          id: newSubId,
          customer: customerId,
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'sub-delete-new-created', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(createPayload)
    })

    // Sanity: the org now has the NEW sub id.
    const beforeDelete = await request<{ stripeSubscriptionId: string | null; subscriptionStatus: string }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-before-stale-delete',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(beforeDelete.body.stripeSubscriptionId).toBe(newSubId)
    expect(beforeDelete.body.subscriptionStatus).toBe('active')

    // Now fire a stale customer.subscription.deleted for the OLD sub id —
    // this is a late Stripe retry from a subscription that was canceled
    // in the past. It MUST NOT clobber the currently-active new sub.
    const staleDeletePayload = {
      id: `evt_sub_old_deleted_${uid}`,
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: oldSubId,
          customer: customerId,
          status: 'canceled',
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'sub-delete-stale', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(staleDeletePayload)
    })

    // The newer subscription must still be intact.
    const afterStale = await request<{ stripeSubscriptionId: string | null; subscriptionStatus: string }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-after-stale-delete',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(afterStale.body.stripeSubscriptionId).toBe(newSubId)
    expect(afterStale.body.subscriptionStatus).toBe('active')
  })

  // @spec billing-and-pricing-design §"Subscription lifecycle"
  it('customer.subscription.updated for an OLD subscription id does NOT corrupt a newer active sub status [INV-REQ-BILLING-AND-PRICING-006]', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `sub-update-stale-${uid}@example.com`,
      password: 'sub-update-stale-pass-12345',
      name: 'Subscription Update Stale Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Subscription Update Stale Org'
    })

    const customerId = `cus_update_stale_${uid}`
    const oldSubId = `sub_update_stale_old_${uid}`
    const newSubId = `sub_update_stale_new_${uid}`

    // Bootstrap org with the NEW active subscription.
    const createPayload = {
      id: `evt_sub_update_new_${uid}`,
      type: 'customer.subscription.created',
      data: {
        object: {
          id: newSubId,
          customer: customerId,
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'sub-update-new-created', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(createPayload)
    })

    // Now fire a stale .updated for the OLD sub id with status=past_due.
    // The org's current sub is the NEW one with status=active. Without
    // the sub-id-match gate, the .updated handler would overwrite the
    // org's status to past_due AND the stripe_subscription_id to the
    // old sub id — corrupting the wrong sub's row.
    const stalePayload = {
      id: `evt_sub_update_stale_${uid}`,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: oldSubId,
          customer: customerId,
          status: 'past_due',
          current_period_end: Math.floor(Date.now() / 1000) - 86_400,
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'sub-update-stale', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(stalePayload)
    })

    const after = await request<{ stripeSubscriptionId: string | null; subscriptionStatus: string }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-after-update-stale',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(after.body.stripeSubscriptionId).toBe(newSubId)
    expect(after.body.subscriptionStatus).toBe('active')
  })

  // @spec billing-and-pricing-design §"Subscription lifecycle"
  it('invoice.payment_failed for an OLD subscription id does NOT corrupt the current active sub status', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `inv-fail-stale-${uid}@example.com`,
      password: 'inv-fail-stale-pass-12345',
      name: 'Invoice Fail Stale Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Invoice Fail Stale Org'
    })

    const customerId = `cus_inv_fail_stale_${uid}`
    const oldSubId = `sub_inv_fail_old_${uid}`
    const newSubId = `sub_inv_fail_new_${uid}`

    // Bootstrap with new active sub.
    await request('/v1/webhooks/stripe', 'inv-fail-create-new', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        id: `evt_inv_fail_create_${uid}`,
        type: 'customer.subscription.created',
        data: {
          object: {
            id: newSubId,
            customer: customerId,
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
            metadata: { organizationId: org.id }
          }
        }
      })
    })

    // Stale invoice.payment_failed for old sub id.
    await request('/v1/webhooks/stripe', 'inv-fail-stale', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        id: `evt_inv_fail_stale_${uid}`,
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: `in_stale_${uid}`,
            customer: customerId,
            subscription: oldSubId,
            metadata: { organizationId: org.id }
          }
        }
      })
    })

    // Org's active sub must still be ACTIVE — the stale invoice for an
    // older sub should not have flipped it to past_due.
    const after = await request<{ subscriptionStatus: string; stripeSubscriptionId: string | null }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-after-inv-fail-stale',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(after.body.stripeSubscriptionId).toBe(newSubId)
    expect(after.body.subscriptionStatus).toBe('active')
  })

  // @spec billing-and-pricing-design §"Subscription lifecycle"
  it('customer.subscription.created for an OLD subscription id does NOT clobber the current active sub', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `sub-create-stale-${uid}@example.com`,
      password: 'sub-create-stale-pass-12345',
      name: 'Subscription Create Stale Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Subscription Create Stale Org'
    })

    const customerId = `cus_create_stale_${uid}`
    const oldSubId = `sub_create_stale_old_${uid}`
    const newSubId = `sub_create_stale_new_${uid}`

    // Bootstrap with the new active sub.
    await request('/v1/webhooks/stripe', 'sub-create-bootstrap-new', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        id: `evt_sub_create_new_${uid}`,
        type: 'customer.subscription.created',
        data: {
          object: {
            id: newSubId,
            customer: customerId,
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
            metadata: { organizationId: org.id }
          }
        }
      })
    })

    // Now fire a stale .created for the OLD sub id (Stripe at-least-once
    // late retry from a previous lifecycle). The handler should drop it.
    await request('/v1/webhooks/stripe', 'sub-create-stale', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        id: `evt_sub_create_stale_${uid}`,
        type: 'customer.subscription.created',
        data: {
          object: {
            id: oldSubId,
            customer: customerId,
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) - 30 * 86_400, // expired
            metadata: { organizationId: org.id }
          }
        }
      })
    })

    const after = await request<{ stripeSubscriptionId: string | null; subscriptionStatus: string }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-after-sub-create-stale',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(after.body.stripeSubscriptionId).toBe(newSubId)
    expect(after.body.subscriptionStatus).toBe('active')
  })

  // @spec billing-and-pricing-design §"Top-up + subscription coexistence"
  it('checkout.session.completed for a top-up (mode=payment) does NOT wipe an active subscription pointer', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `topup-coexist-${uid}@example.com`,
      password: 'topup-coexist-pass-12345',
      name: 'Top-up Coexist Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Top-up Coexist Org'
    })

    const customerId = `cus_topup_coexist_${uid}`
    const activeSubId = `sub_topup_coexist_active_${uid}`

    // Bootstrap: org has an active subscription via .created.
    await request('/v1/webhooks/stripe', 'topup-coexist-create', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        id: `evt_topup_coexist_create_${uid}`,
        type: 'customer.subscription.created',
        data: {
          object: {
            id: activeSubId,
            customer: customerId,
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
            metadata: { organizationId: org.id }
          }
        }
      })
    })

    // Sanity: org has the active subscription.
    const beforeTopUp = await request<{ stripeSubscriptionId: string | null }>(
      `/v1/organizations/${org.id}/billing`,
      'topup-coexist-before',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(beforeTopUp.body.stripeSubscriptionId).toBe(activeSubId)

    // User does a top-up via Stripe Checkout (mode=payment, no subscription
    // field on the session). The webhook handler MUST NOT overwrite the
    // active subscription pointer with null.
    await request('/v1/webhooks/stripe', 'topup-coexist-checkout-completed', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        id: `evt_topup_coexist_checkout_${uid}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_topup_coexist_${uid}`,
            customer: customerId,
            mode: 'payment',
            amount_total: 1000, // $10 top-up
            payment_method: `pm_topup_coexist_${uid}`,
            // subscription field is intentionally absent for payment-mode
            metadata: { organizationId: org.id }
          }
        }
      })
    })

    const afterTopUp = await request<{ stripeSubscriptionId: string | null; subscriptionStatus: string }>(
      `/v1/organizations/${org.id}/billing`,
      'topup-coexist-after',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(afterTopUp.body.stripeSubscriptionId).toBe(activeSubId) // <-- the regression
    expect(afterTopUp.body.subscriptionStatus).toBe('active')
  })

  // @spec billing-and-pricing-design §"Top-up + subscription coexistence"
  it('checkout.session.completed for a top-up ignores stray subscription fields on payment-mode sessions', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `topup-ignore-sub-${uid}@example.com`,
      password: 'topup-ignore-sub-pass-12345',
      name: 'Top-up Ignore Subscription Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Top-up Ignore Subscription Org'
    })

    const customerId = `cus_topup_ignore_sub_${uid}`
    const activeSubId = `sub_topup_ignore_active_${uid}`

    await request('/v1/webhooks/stripe', 'topup-ignore-sub-create', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        id: `evt_topup_ignore_sub_create_${uid}`,
        type: 'customer.subscription.created',
        data: {
          object: {
            id: activeSubId,
            customer: customerId,
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
            metadata: { organizationId: org.id }
          }
        }
      })
    })

    const straySubId = `sub_topup_ignore_stray_${uid}`
    await request('/v1/webhooks/stripe', 'topup-ignore-sub-checkout', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        id: `evt_topup_ignore_sub_checkout_${uid}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_topup_ignore_sub_${uid}`,
            customer: customerId,
            mode: 'payment',
            amount_total: 1000,
            payment_method: `pm_topup_ignore_sub_${uid}`,
            subscription: straySubId,
            metadata: {
              organizationId: org.id,
              subscriptionPlan: 'agency'
            }
          }
        }
      })
    })

    const afterTopUp = await request<{
      stripeSubscriptionId: string | null
      subscriptionPlan: string | null
      subscriptionStatus: string
    }>(
      `/v1/organizations/${org.id}/billing`,
      'topup-ignore-sub-after',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(afterTopUp.body.stripeSubscriptionId).toBe(activeSubId)
    expect(afterTopUp.body.subscriptionPlan).toBe('pro')
    expect(afterTopUp.body.subscriptionStatus).toBe('active')
  })

  it('customer.subscription.updated does NOT resurrect a canceled subscription when arriving out of order', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `sub-order-${uid}@example.com`,
      password: 'sub-order-pass-12345',
      name: 'Subscription Ordering Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Subscription Ordering Org'
    })

    const subId = `sub_ordering_${uid}`
    const customerId = `cus_ordering_${uid}`

    // Step 1: cancel the subscription via customer.subscription.deleted.
    const deletePayload = {
      id: `evt_sub_deleted_${uid}`,
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: subId,
          customer: customerId,
          status: 'canceled',
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'sub-deleted', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(deletePayload)
    })

    // Sanity: sub is canceled.
    const afterDelete = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-after-delete',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(afterDelete.body.isSubscribed).toBe(false)
    expect(afterDelete.body.subscriptionStatus).toBe('canceled')

    // Step 2: late `customer.subscription.updated` retry — a stale event
    // that Stripe delivered after the .deleted. The status in the payload
    // is `active` (the state before the cancellation). Without a guard
    // the billing service would overwrite canceled back to active.
    const staleUpdatePayload = {
      id: `evt_sub_updated_stale_${uid}`,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: subId,
          customer: customerId,
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'sub-updated-stale', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(staleUpdatePayload)
    })

    // Step 3: sub must STILL be canceled. No resurrection.
    const afterStale = await request<{ isSubscribed: boolean; subscriptionStatus: string }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-after-stale',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(afterStale.body.isSubscribed).toBe(false)
    expect(afterStale.body.subscriptionStatus).toBe('canceled')
  })

  // Regression for the iter-4 fix: `updateSubscriptionFields` embeds a
  // monotonic WHERE predicate `(existing IS NULL OR existing <= new)` on
  // `subscriptionCurrentPeriodEnd`. Without this guard, two
  // `customer.subscription.updated` events with the SAME sub id arriving
  // out of order (e.g. Stripe retry delivering an earlier plan-change
  // event AFTER a later one) would roll the period end backwards,
  // corrupting usage-cap reset timing and monthly rollup alignment.
  //
  // @spec billing-and-pricing-design §"Subscription lifecycle"
  it('customer.subscription.updated does NOT roll subscriptionCurrentPeriodEnd backwards for the same sub id', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx, {
      email: `sub-period-rollback-${uid}@example.com`,
      password: 'sub-period-rollback-pass-12345',
      name: 'Subscription Period Rollback Owner'
    })
    const org = await createOrganization(ctx, {
      token: owner.token,
      name: 'Subscription Period Rollback Org'
    })

    const customerId = `cus_period_rollback_${uid}`
    const subId = `sub_period_rollback_${uid}`
    const now = Math.floor(Date.now() / 1000)
    const periodT30 = now + 30 * 86_400 // initial period end
    const periodT60 = now + 60 * 86_400 // forward-moved period end
    const periodT45 = now + 45 * 86_400 // stale, earlier than current

    // Step 1: seed the subscription with initial period end at T+30d.
    const createPayload = {
      id: `evt_sub_period_created_${uid}`,
      type: 'customer.subscription.created',
      data: {
        object: {
          id: subId,
          customer: customerId,
          status: 'active',
          current_period_end: periodT30,
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'sub-period-created', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(createPayload)
    })

    // Step 2: forward-move the period end to T+60d (e.g. a plan change
    // extending the cycle). The monotonic guard must ALLOW this.
    const forwardUpdatePayload = {
      id: `evt_sub_period_forward_${uid}`,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: subId,
          customer: customerId,
          status: 'active',
          current_period_end: periodT60,
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'sub-period-forward', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(forwardUpdatePayload)
    })

    const afterForward = await request<{ subscriptionCurrentPeriodEnd: string | null }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-after-forward',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(afterForward.body.subscriptionCurrentPeriodEnd).not.toBeNull()
    const afterForwardMs = Date.parse(afterForward.body.subscriptionCurrentPeriodEnd!)
    expect(afterForwardMs).toBe(periodT60 * 1000)

    // Step 3: fire a STALE update with an earlier period end (T+45d).
    // Same sub id, status still allowed by `onlyIfStatusIn`, so without
    // the monotonic guard the update would land and roll period_end
    // backwards. The guard MUST block the write.
    const staleUpdatePayload = {
      id: `evt_sub_period_stale_${uid}`,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: subId,
          customer: customerId,
          status: 'active',
          current_period_end: periodT45,
          metadata: { organizationId: org.id }
        }
      }
    }
    await request('/v1/webhooks/stripe', 'sub-period-stale', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify(staleUpdatePayload)
    })

    const afterStale = await request<{ subscriptionCurrentPeriodEnd: string | null }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-after-period-stale',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    // Period end must STILL be the forward-moved value. The stale event
    // was dropped by the monotonic guard.
    expect(afterStale.body.subscriptionCurrentPeriodEnd).not.toBeNull()
    expect(Date.parse(afterStale.body.subscriptionCurrentPeriodEnd!)).toBe(periodT60 * 1000)

    // Step 4: same-value retry (Stripe redelivery of the forward event)
    // must remain idempotent — the `<=` in the guard allows equal values
    // so retries don't have to be filtered at a different layer.
    await request('/v1/webhooks/stripe', 'sub-period-forward-retry', {
      method: 'POST',
      headers: { 'stripe-signature': 'integration-signature' },
      body: JSON.stringify({
        ...forwardUpdatePayload,
        id: `evt_sub_period_forward_retry_${uid}`
      })
    })

    const afterRetry = await request<{ subscriptionCurrentPeriodEnd: string | null }>(
      `/v1/organizations/${org.id}/billing`,
      'billing-after-forward-retry',
      { method: 'GET', headers: { authorization: `Bearer ${owner.token}` } }
    )
    expect(afterRetry.body.subscriptionCurrentPeriodEnd).not.toBeNull()
    expect(Date.parse(afterRetry.body.subscriptionCurrentPeriodEnd!)).toBe(periodT60 * 1000)
  })
})
