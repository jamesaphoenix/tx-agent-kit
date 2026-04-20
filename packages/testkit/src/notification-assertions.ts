import { expect } from 'vitest'
import type { Client, PoolClient } from 'pg'
import type { SqlTestContext } from './sql-context.js'

type QueryableClient = Client | PoolClient

export interface NotificationOutboxAssertionInput {
  organizationId: string
  userId: string
  outboxEventId: string
  eventType?: string
  titleIncludes?: string
}

export interface NotificationOutboxRow {
  id: string
  event_type: string
  title: string
}

export const queryNotificationsForOutboxEventWithClient = async (
  client: QueryableClient,
  input: Pick<NotificationOutboxAssertionInput, 'organizationId' | 'userId' | 'outboxEventId'>
): Promise<NotificationOutboxRow[]> => {
  const result = await client.query<NotificationOutboxRow>(
    `SELECT id, event_type, title
       FROM notifications
      WHERE organization_id = $1
        AND user_id = $2
        AND metadata->>'outbox_event_id' = $3`,
    [input.organizationId, input.userId, input.outboxEventId]
  )
  return result.rows
}

export const expectNotificationForOutboxEventWithClient = async (
  client: QueryableClient,
  input: NotificationOutboxAssertionInput
): Promise<NotificationOutboxRow> => {
  const rows = await queryNotificationsForOutboxEventWithClient(client, input)
  expect(
    rows,
    `Expected exactly one notification for outbox event ${input.outboxEventId}`
  ).toHaveLength(1)

  const row = rows[0]
  if (!row) {
    throw new Error(`Expected notification row for outbox event ${input.outboxEventId}`)
  }

  if (input.eventType) {
    expect(row.event_type).toBe(input.eventType)
  }
  if (input.titleIncludes) {
    expect(row.title.toLowerCase()).toContain(input.titleIncludes.toLowerCase())
  }

  return row
}

export const expectNotificationForOutboxEvent = async (
  ctx: SqlTestContext,
  input: NotificationOutboxAssertionInput
): Promise<NotificationOutboxRow> =>
  ctx.withSchemaClient((client) => expectNotificationForOutboxEventWithClient(client, input))
