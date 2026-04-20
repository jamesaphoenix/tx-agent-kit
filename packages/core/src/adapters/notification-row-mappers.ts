import type { NotificationRowShape } from '@tx-agent-kit/db'
import type { NotificationRecord } from '../domains/notifications/domain/notification-domain.js'

/**
 * Notification domain record is a straight pass-through of the DB row
 * shape — no joined columns, no computed fields. This mapper exists only
 * so notification adapters can satisfy the
 * `core-adapters-use-db-row-mappers` lint invariant (every core adapter
 * that imports `@tx-agent-kit/db` must centralize row → record mapping
 * in this directory).
 */
export const toNotificationRecord = (row: NotificationRowShape): NotificationRecord => row
