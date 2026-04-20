import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

export interface TestSerializedDomainEvent {
  id: string
  eventType: string
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
  correlationId: string | null
  sequenceNumber: number
  status: string
  occurredAt: string
  processingAt: string | null
  publishedAt: string | null
  failedAt: string | null
  failureReason: string | null
  createdAt: string
}

export interface BuildSerializedDomainEventInput {
  eventType: string
  aggregateType?: string
  aggregateId: string
  payload: Record<string, unknown>
  eventId?: string
  sequenceNumber?: number
  occurredAt?: string
}

export const buildSerializedDomainEvent = (
  input: BuildSerializedDomainEventInput
): TestSerializedDomainEvent => {
  const now = input.occurredAt ?? new Date().toISOString()
  return {
    id: input.eventId ?? randomUUID(),
    eventType: input.eventType,
    aggregateType: input.aggregateType ?? 'billing',
    aggregateId: input.aggregateId,
    payload: input.payload,
    correlationId: null,
    sequenceNumber: input.sequenceNumber ?? 1,
    status: 'pending',
    occurredAt: now,
    processingAt: null,
    publishedAt: null,
    failedAt: null,
    failureReason: null,
    createdAt: now
  }
}

export interface SeedBillingOrganizationOptions {
  prefix?: string
  creditsBalance?: number
  billingEmail?: string | null
  subscriptionPlan?: string | null
  isSubscribed?: boolean
  subscriptionStatus?: string
}

export interface SeededBillingOrganization {
  orgId: string
  organizationId: string
  userId: string
  billingEmail: string | null
}

export const seedBillingOrganization = async (
  pool: Pool,
  options: SeedBillingOrganizationOptions = {}
): Promise<SeededBillingOrganization> => {
  const prefix = options.prefix ?? 'billing-test'
  const userId = randomUUID()
  const orgId = randomUUID()
  const billingEmail = options.billingEmail === undefined
    ? `${prefix}-billing-${userId}@example.invalid`
    : options.billingEmail

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
      [
        userId,
        `${prefix}-${userId}@example.invalid`,
        'test-hash',
        `${prefix} user ${userId}`
      ]
    )
    await client.query(
      `INSERT INTO organizations (
         id,
         name,
         owner_user_id,
         billing_email,
         credits_balance,
         subscription_plan,
         is_subscribed,
         subscription_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orgId,
        `${prefix} ${orgId}`,
        userId,
        billingEmail,
        options.creditsBalance ?? 0,
        options.subscriptionPlan ?? null,
        options.isSubscribed ?? false,
        options.subscriptionStatus ?? 'inactive'
      ]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return { orgId, organizationId: orgId, userId, billingEmail }
}

export interface CleanupBillingOrganizationsInput {
  organizationIds: ReadonlyArray<string>
  userIds: ReadonlyArray<string>
}

export const cleanupBillingOrganizations = async (
  pool: Pool,
  input: CleanupBillingOrganizationsInput
): Promise<void> => {
  if (input.organizationIds.length === 0 && input.userIds.length === 0) {
    return
  }

  const client = await pool.connect()
  try {
    if (input.organizationIds.length > 0) {
      await client.query(
        `DELETE FROM notifications WHERE organization_id = ANY($1::uuid[])`,
        [input.organizationIds]
      )
      await client.query(
        `DELETE FROM domain_events WHERE aggregate_id = ANY($1::uuid[])`,
        [input.organizationIds]
      )
      await client.query(
        `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
        [input.organizationIds]
      )
    }
    if (input.userIds.length > 0) {
      await client.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[])`,
        [input.userIds]
      )
    }
  } finally {
    client.release()
  }
}
