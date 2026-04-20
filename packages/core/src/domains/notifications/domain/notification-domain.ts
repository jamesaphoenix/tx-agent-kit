import type { JsonObject, NotificationRowShape } from '@tx-agent-kit/db'

/**
 * A persisted notification row. Extends the Drizzle row shape directly so
 * new DB columns surface automatically through the domain type.
 */
export type NotificationRecord = NotificationRowShape

/**
 * Command to create a new notification. `organizationId` is nullable so
 * global (non-org-scoped) notifications are representable, though Phase 1
 * always sets it. `userId` is nullable for future org-wide broadcasts,
 * though Phase 1 always resolves a specific recipient before dispatch.
 */
export interface CreateNotificationCommand {
  organizationId: string | null
  userId: string | null
  eventType: NotificationEventType
  title: string
  body: string
  metadata?: JsonObject
}

/**
 * Command to mark a notification as read. Enforces ownership via the
 * composite (id, userId) where clause at the repository layer.
 */
export interface MarkReadCommand {
  id: string
  userId: string
}

/**
 * Command to list notifications for a given user + org scope with optional
 * cursor pagination and unread-only filtering.
 */
export interface ListNotificationsCommand {
  userId: string
  organizationId: string
  unreadOnly?: boolean
  limit?: number
  cursor?: Date
}

/**
 * Notification event type discriminant. Modelled as an opaque string so the
 * notifications domain remains decoupled from the individual domain event
 * taxonomies. In Phase 1 every value is a billing event (e.g.
 * `'billing.welcome_credit_granted'`), but the contract is intentionally
 * open so the worker handler can map future event types without touching
 * the notifications domain.
 *
 * @spec notifications-design §"18 Notification Event Types"
 */
export type NotificationEventType = string
