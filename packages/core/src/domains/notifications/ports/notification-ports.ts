import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type {
  CreateNotificationCommand,
  ListNotificationsCommand,
  MarkReadCommand,
  NotificationRecord
} from '../domain/notification-domain.js'

/**
 * Repository-kind tag required by `enforce-route-kind-contracts.mjs`.
 * Notifications use a custom CRUD-lite shape (no list-all / getById /
 * bulk update), so declare 'custom' rather than 'crud'.
 */
export const NotificationRepositoryKind = 'custom' as const

/**
 * Port for persisting and querying notification rows. The Phase 1 surface is
 * deliberately small: create, create batch, list for a user, mark read, and
 * count unread. Digest batching, preferences, and fan-out dispatch helpers
 * are deferred to later phases.
 *
 * @spec notifications-design §"Minimal-First Implementation Plan"
 */
export class NotificationStorePort extends Context.Tag('NotificationStorePort')<
  NotificationStorePort,
  {
    create: (input: CreateNotificationCommand) => Effect.Effect<NotificationRecord, unknown>
    createBatch: (
      inputs: ReadonlyArray<CreateNotificationCommand>
    ) => Effect.Effect<ReadonlyArray<NotificationRecord>, unknown>
    listForUser: (
      input: ListNotificationsCommand
    ) => Effect.Effect<ReadonlyArray<NotificationRecord>, unknown>
    markRead: (input: MarkReadCommand) => Effect.Effect<NotificationRecord | null, unknown>
    countUnread: (
      input: { userId: string; organizationId: string }
    ) => Effect.Effect<number, unknown>
  }
>() {}
