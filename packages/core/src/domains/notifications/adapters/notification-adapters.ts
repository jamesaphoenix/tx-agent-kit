import { notificationsRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import { mapNullable, toNotificationRecord } from '../../../adapters/db-row-mappers.js'
import { NotificationStorePort } from '../ports/notification-ports.js'

/**
 * Live adapter for the {@link NotificationStorePort}. Delegates every
 * operation to the Drizzle repository. Row → record mapping goes through
 * `toNotificationRecord` in `core/src/adapters/db-row-mappers.ts` per the
 * `core-adapters-use-db-row-mappers` lint invariant.
 */
export const NotificationStorePortLive = Layer.succeed(NotificationStorePort, {
  create: (input) =>
    notificationsRepository
      .create({
        organizationId: input.organizationId,
        userId: input.userId,
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        metadata: input.metadata
      })
      .pipe(Effect.map(toNotificationRecord)),

  createBatch: (inputs) =>
    notificationsRepository
      .createBatch(
        inputs.map((input) => ({
          organizationId: input.organizationId,
          userId: input.userId,
          eventType: input.eventType,
          title: input.title,
          body: input.body,
          metadata: input.metadata
        }))
      )
      .pipe(Effect.map((rows) => rows.map(toNotificationRecord))),

  listForUser: (input) =>
    notificationsRepository
      .listForUser({
        userId: input.userId,
        organizationId: input.organizationId,
        unreadOnly: input.unreadOnly,
        limit: input.limit,
        cursor: input.cursor
      })
      .pipe(Effect.map((rows) => rows.map(toNotificationRecord))),

  markRead: (input) =>
    notificationsRepository
      .markRead({
        id: input.id,
        userId: input.userId
      })
      .pipe(Effect.map((row) => mapNullable(row, toNotificationRecord))),

  countUnread: (input) =>
    notificationsRepository.countUnread({
      userId: input.userId,
      organizationId: input.organizationId
    })
})
