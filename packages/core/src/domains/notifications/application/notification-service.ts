import { Context, Effect, Layer } from 'effect'
import { badRequest, type CoreError } from '../../../errors.js'
import type {
  CreateNotificationCommand,
  ListNotificationsCommand,
  MarkReadCommand,
  NotificationRecord
} from '../domain/notification-domain.js'
import { NotificationStorePort } from '../ports/notification-ports.js'

/**
 * Notification service — the Phase 1 application layer for the
 * notifications domain. Exposes five operations: create, list, mark read,
 * count unread, and a convenience `create` that is the same as the port
 * call but translates unknown errors into `CoreError` at the seam.
 *
 * Dispatch orchestration (recipient resolution, preference lookups, digest
 * batching) is deferred to Phase 2. In Phase 1, callers (the worker's
 * `billing-notification-handler.ts`) resolve recipients themselves and
 * invoke `create` once per resolved user.
 *
 * @spec notifications-design §"Minimal-First Implementation Plan"
 */
export class NotificationService extends Context.Tag('NotificationService')<
  NotificationService,
  {
    create: (
      input: CreateNotificationCommand
    ) => Effect.Effect<NotificationRecord, CoreError, NotificationStorePort>
    /**
     * Fan-out helper used by Phase 2 dispatch workflows that need to
     * insert one notification per recipient in a single round-trip.
     * Surfaced through the service so callers don't have to import the
     * repository directly and bypass the error-translation seam.
     */
    createBatch: (
      inputs: ReadonlyArray<CreateNotificationCommand>
    ) => Effect.Effect<ReadonlyArray<NotificationRecord>, CoreError, NotificationStorePort>
    listForUser: (
      input: ListNotificationsCommand
    ) => Effect.Effect<ReadonlyArray<NotificationRecord>, CoreError, NotificationStorePort>
    markRead: (
      input: MarkReadCommand
    ) => Effect.Effect<NotificationRecord | null, CoreError, NotificationStorePort>
    countUnread: (
      input: { userId: string; organizationId: string }
    ) => Effect.Effect<number, CoreError, NotificationStorePort>
  }
>() {}

export const NotificationServiceLive = Layer.succeed(NotificationService, {
  create: (input) =>
    Effect.gen(function* () {
      const store = yield* NotificationStorePort
      return yield* store
        .create(input)
        .pipe(Effect.mapError((cause) => badRequest('Failed to create notification', cause)))
    }),

  createBatch: (inputs) =>
    Effect.gen(function* () {
      const store = yield* NotificationStorePort
      return yield* store
        .createBatch(inputs)
        .pipe(Effect.mapError((cause) => badRequest('Failed to create notifications batch', cause)))
    }),

  listForUser: (input) =>
    Effect.gen(function* () {
      const store = yield* NotificationStorePort
      return yield* store
        .listForUser(input)
        .pipe(Effect.mapError((cause) => badRequest('Failed to list notifications', cause)))
    }),

  markRead: (input) =>
    Effect.gen(function* () {
      const store = yield* NotificationStorePort
      return yield* store
        .markRead(input)
        .pipe(Effect.mapError((cause) => badRequest('Failed to mark notification read', cause)))
    }),

  countUnread: (input) =>
    Effect.gen(function* () {
      const store = yield* NotificationStorePort
      return yield* store
        .countUnread(input)
        .pipe(Effect.mapError((cause) => badRequest('Failed to count unread notifications', cause)))
    })
})
