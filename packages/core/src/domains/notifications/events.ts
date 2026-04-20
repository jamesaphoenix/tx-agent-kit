/**
 * Public cross-domain event contract for the notifications domain.
 *
 * Notifications is a CONSUMER-ONLY domain — it does not emit any
 * cross-domain events. This file intentionally exports nothing beyond a
 * marker symbol so other domains cannot accidentally import notification
 * internals. Keep it empty as long as the subsystem remains consumer-only.
 *
 * Rules:
 * - Only event-related types belong here (payloads, discriminants, versions)
 * - Internal domain types, services, repos, and errors must NOT be exported here
 * - The notifications domain consumes `billing.*` and other domain events
 *   via the transactional outbox; see `apps/worker/src/billing-notification-handler.ts`
 *   (Slice 6) for the consumer wiring.
 *
 * @spec notifications-design §"Scope boundary with billing"
 */

export const notificationsDomainMarker = 'notifications' as const
