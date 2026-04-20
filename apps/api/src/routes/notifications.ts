/**
 * Colocation anchor for `notifications.integration.test.ts`.
 *
 * The Phase 1 notifications surface is deliberately scoped to the
 * repository layer (the billing worker handler in Slice 6 will drive it
 * via `NotificationService.create`). No HTTP routes are exposed yet — a
 * future slice will add `GET /v1/organizations/:orgId/notifications`,
 * `PATCH /v1/organizations/:orgId/notifications/:id/read`, and the
 * unread-count endpoint per the notifications spec.
 *
 * This file exists to satisfy the test-colocation lint invariant and
 * the `enforce-route-kind-contracts.mjs` route kind rule.
 *
 * @spec notifications-design §"Minimal-First Implementation Plan"
 */

/**
 * Route-kind tag. Notifications have no mounted HTTP routes yet, so
 * `'custom'` declares the slot without implying a CRUD shape. When the
 * Phase 2 HTTP surface lands the tag can stay as `'custom'` (the spec
 * only supports list / mark-read / count-unread, not full CRUD).
 */
export const NotificationRouteKind = 'custom' as const
