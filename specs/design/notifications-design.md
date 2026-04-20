---
kind: spec
spec_type: design
doc_id: doc-a1b2c3d4e5f6
name: notifications-design
title: "Notifications"
status: draft
version: 2
owners:
  - jamesaphoenix
summary: "In-app and email notification subsystem with per-user preferences, digest batching, and Temporal workflow delivery."
domain: notifications
tags:
  - design
  - notifications
  - email
depends_on:
  - tenancy-model-design
  - billing-and-pricing-design
supersedes: []
implements: null
last_reviewed_at: 2026-04-16
---

# Summary

tx-agent-kit subsystem #5 provides two notification channels: **in-app** (stored in Postgres, delivered
via API polling or SSE) and **email** (delivered asynchronously through Temporal workflows). Every
notification originates from typed domain events emitted by other subsystems. Users control
delivery per event type through a preference matrix (immediate / digest / off) stored per user per
organization. Digest batching collapses high-frequency events into a single morning email.

The subsystem is intentionally thin -- it owns no business logic beyond routing and delivery. It
consumes domain events from the transactional outbox and fans them out to the appropriate channels
based on user preferences.

This spec covers subsystem **#5 Notifications** from the original system design.

# Minimal-First Implementation Plan (2026-04-14)

The full spec below describes the end state. The **initial shipping version** is deliberately
smaller. It exists to unblock the billing subsystem, which is currently emitting outbox events
that nothing consumes. Build in this order:

## Phase 1 — Billing events only (target: 3–5 days of work)

1. **Reuse existing email infra.** `packages/infra/email/` is already wired:
   - `EmailDeliveryPort` (Resend-backed) at `packages/infra/email/src/delivery.ts`
   - React Email templates at `packages/infra/email/src/templates/` (shared layout + onboarding)
   - Svix-verified delivery webhooks at `packages/infra/email/src/webhook.ts`
   - `email_sends` tracking table with full delivery lifecycle (sent/delivered/opened/clicked/bounced)
   - Existing usage pattern: `PasswordResetEmailPort` (auth), `InvitationEmailPort` (organization)

   **Do not build new email infrastructure.** This spec's `EmailDeliveryPort` type signature
   already matches what's shipped.

2. **Create the minimal notifications domain** at `packages/core/src/domains/notifications/`:
   - `events.ts` — empty (notifications is a consumer-only domain, no outbound cross-domain events)
   - `domain/notification-domain.ts` — `NotificationRecord`, `CreateNotificationCommand`
   - `ports/notification-ports.ts` — only `NotificationStorePort` with `create`, `listForUser`,
     `markRead`, `countUnread`
   - `application/notification-service.ts` — only `NotificationService.create` (no dispatch
     orchestration, no preference lookups, no digest)
   - `adapters/notification-adapters.ts` — Drizzle adapter for `notifications` table

3. **Create the `notifications` table** per the Data Model section below (same schema, with
   `digest_batch_id` and `emailed_at` columns present but unused in Phase 1).

4. **Add billing email templates** to `packages/infra/email/src/templates/billing/`:
   - `welcome-credit-granted.tsx` — first-charge welcome with credit amount
   - `credits-low-balance.tsx` — auto-recharge threshold crossed
   - `credits-purchased.tsx` — top-up success receipt
   - `credits-recharged.tsx` — auto-recharge success receipt
   - `credits-refunded.tsx` — Stripe refund receipt / balance adjustment
   - `recharge-requires-action.tsx` — 3DS challenge surface (contains Stripe-hosted action URL)
   - `payment-failed.tsx` — grace period notice with resolution link
   - `usage-cap-warning.tsx` — parameterized for 80% and 95%
   - `usage-cap-exceeded.tsx` — hard-stop notice with top-up link
   - `dispute-created.tsx` — chargeback frozen notice
   - `subscription-cancelled.tsx` — offboarding

5. **Add a `BillingEmailPort`** in the billing domain (`packages/core/src/domains/billing/ports/`)
   mirroring `PasswordResetEmailPort` and `InvitationEmailPort`. One method per template. The
   adapter in `apps/api/src/adapters/` renders the template and calls `EmailDeliveryPort.send`.

6. **Build a worker handler** at `apps/worker/src/billing-notification-handler.ts` that subscribes
   to `billing.*` outbox events and fans out:
   - `NotificationService.create` for the in-app row (always)
   - `BillingEmailPort.send<TemplateName>` for the email (always, in Phase 1 — preferences come later)
   - Idempotency via `notifications.metadata.outbox_event_id` unique constraint
   - Email delivery is best-effort after the in-app row exists; failures are logged and do not
     roll back or block notification visibility.
   - Billing email action links must be derived from the configured web base URL and include the
     organization route segment so local, staging, and production emails land inside the correct
     billing surface.

**Implementation status (2026-04-16):** Phase 1 is implemented for billing events. The worker
handler creates idempotent in-app notification rows keyed by `metadata.outbox_event_id`, renders
the billing email templates through `BillingEmailPort`, and catches email failures after the
notification row is persisted. The billing workflow layer calls `notifyBillingEvent` for purchase,
recharge, low-balance, usage-cap, payment-failure, dispute, cancellation, refund, and welcome-credit
events. In-app creation is race-safe under concurrent worker fan-out, and billing email action links
are built from `WEB_BASE_URL` plus org-scoped `/org/{organizationId}/billing...` routes. Preferences,
digest batching, retention pruning, and non-billing event types remain Phase 2+.

## Phase 2 — Preferences and full event catalog (deferred)

Phase 2 adds `notification_preferences`, the full dispatch workflow, recipient resolution per
event type, and the remaining 14 non-billing event types. Digest batching is Phase 3.

**Why phase it this way:** Phase 1 unblocks the most pressing UX gap (users not hearing about
their own billing events) with ~300 lines of net-new code. Phase 2 adds the configurability and
breadth. Building Phase 1 first avoids the "design everything, ship nothing" trap and validates
the architecture against a concrete first consumer.

## Scope boundary with billing

The billing subsystem is responsible for **emitting** events to the outbox. The notifications
subsystem is responsible for **consuming** those events and fanning them out to in-app +
email channels. Billing application services never call notifications inside the transaction.
Worker consumers process the already-committed outbox event and then invoke notification fan-out,
preserving the transactional guarantees of `INV-BILLING-009`.

The `notifications` domain has zero outbound cross-domain events and no `events.ts` exports
beyond its own internal event types. Other domains never import from the notifications domain.

# Architecture

## Channels

| Channel | Storage | Delivery | Latency |
|---------|---------|----------|---------|
| In-app | `notifications` table in Postgres | API polling (`GET /notifications`) or SSE push | Near real-time |
| Email | Transient (rendered and sent) | Temporal workflow via email provider (Resend) | Seconds (immediate) or batched (digest) |

## Event Flow

```
Domain event emitted (transactional outbox)
    |
    v
NotificationDispatchWorkflow (Temporal)
    |
    ├── 1. Resolve recipients for the event
    │      (e.g., org admins, campaign manager, specific user)
    |
    ├── 2. For each recipient, read notification_preferences
    │      |
    │      ├── channel = "in_app" (always on for all event types)
    │      │     └── Insert row into `notifications` table
    │      |
    │      ├── channel = "email", mode = "immediate"
    │      │     └── Dispatch EmailDeliveryActivity immediately
    │      |
    │      ├── channel = "email", mode = "digest"
    │      │     └── Enqueue into digest buffer (notifications table with
    │      │         digest_batch_id, emailed_at = NULL)
    │      |
    │      └── channel = "email", mode = "off"
    │            └── Skip email delivery
    |
    └── 3. Done
```

## Digest Batching

A scheduled Temporal workflow (`DigestBatchWorkflow`) runs daily at a configurable hour (default:
08:00 in the org's timezone). It:

1. Queries all `notifications` where `digest_batch_id IS NOT NULL AND emailed_at IS NULL` grouped
   by `(user_id, organization_id)`.
2. Renders a single digest email per user per org summarising all pending notifications.
3. Sends via `EmailDeliveryActivity`.
4. Sets `emailed_at` on all included notifications.

If the digest contains zero notifications, no email is sent.

## Morning Batch Summary

The nightly campaign batch workflow (subsystem #15) emits a `campaign.morning_summary` event after
all campaign posts have been processed. This event includes aggregate results (success count,
failure count, credit spend). The notification subsystem treats it like any other event -- it
resolves recipients (org admins), checks preferences, and delivers via the appropriate channel.

## Notification Event Types

| # | Event Type | Default Email Mode | Recipients |
|---|------------|-------------------|------------|
| 1 | `post.publish_success` | digest | Post creator |
| 2 | `post.publish_failure` | immediate | Post creator + org admins |
| 3 | `campaign.morning_summary` | immediate | Org admins |
| 4 | `oauth.token_refresh_failure` | immediate | Account owner + org admins |
| 5 | `content.awaiting_approval` | immediate | Team members with `approve` permission |
| 6 | `usage.cap_80_percent` | immediate | Org admins |
| 7 | `usage.cap_95_percent` | immediate | Org admins |
| 8 | `usage.cap_100_percent` | immediate | Org admins |
| 9 | `campaign.budget_80_percent` | immediate | Campaign manager + org admins |
| 10 | `campaign.budget_100_percent` | immediate | Campaign manager + org admins |
| 11 | `storage.threshold_80_percent` | immediate | Org admins |
| 12 | `storage.overage` | immediate | Org admins |
| 13 | `billing.credits_purchased` | immediate | Org admins |
| 14 | `billing.credits_recharged` | immediate | Org admins |
| 15 | `billing.credits_refunded` | immediate | Org admins |
| 16 | `billing.recharge_requires_action` | immediate | Org admins |
| 17 | `billing.payment_failed` | immediate | Org admins |
| 18 | `billing.dispute_created` | immediate | Org admins |
| 19 | `billing.dispute_resolved` | immediate | Org admins |
| 20 | `org.invitation_sent` | immediate | Invitee (by email address) |
| 21 | `org.invitation_accepted` | immediate | Inviting user + org admins |
| 22 | `org.member_removed` | immediate | Removed user |

**In-app is always on** for all event types. Email mode (immediate / digest / off) is configurable
per user per event type via `notification_preferences`.

**Phase 1 recipient note:** billing notification fan-out currently resolves the organization owner
only and sends email to `organizations.billing_email` when present, otherwise the owner email. Full
admin fan-out and preference-aware recipient expansion are part of Phase 2.

## Recipient Resolution

Each event type has a deterministic recipient resolver:

- **Org admins**: Query `organization_members` where `role = 'admin'`.
- **Campaign manager**: The user who created the campaign (`campaigns.created_by`).
- **Post creator**: The user who created the scheduled post.
- **Account owner**: The user who connected the social account.
- **Team approvers**: Team members with the `approve` permission.
- **Invitee**: Resolved by email address (may not be a user yet -- email-only delivery).
- **Specific user**: Directly referenced in the event payload.

# Data Model

## `notifications` Table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | PK |
| `organization_id` | UUID | FK -> organizations. Scopes notification to an org. |
| `user_id` | UUID | FK -> users. Recipient. |
| `event_type` | TEXT | One of the 18 event types (e.g., `post.publish_success`) |
| `title` | TEXT | Short human-readable title |
| `body` | TEXT | Notification body (plain text or markdown) |
| `metadata` | JSONB | Event-specific payload (post ID, campaign ID, amounts, etc.) |
| `read_at` | TIMESTAMPTZ (nullable) | When the user dismissed / read the notification |
| `digest_batch_id` | UUID (nullable) | Groups notifications for a single digest email. NULL if not part of a digest. |
| `emailed_at` | TIMESTAMPTZ (nullable) | When the email was sent (NULL if not yet emailed or email mode = off) |
| `created_at` | TIMESTAMPTZ | Default `now()` |

**Indexes:**

- `(user_id, organization_id, created_at DESC)` -- primary query path for in-app notification feed.
- `(digest_batch_id) WHERE digest_batch_id IS NOT NULL AND emailed_at IS NULL` -- digest batch
  query.
- `(organization_id, event_type, created_at DESC)` -- admin audit queries.

**Retention:** 90 days. A scheduled Temporal workflow prunes rows older than 90 days weekly.
Notifications are not financial records -- they are safe to delete.

## `notification_preferences` Table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | PK |
| `user_id` | UUID | FK -> users |
| `organization_id` | UUID | FK -> organizations |
| `event_type` | TEXT | One of the 18 event types |
| `email_mode` | TEXT | `immediate`, `digest`, or `off`. Default varies by event type. |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Constraints:**

- `UNIQUE (user_id, organization_id, event_type)` -- one preference row per user per org per event
  type.

**Default behavior:** If no preference row exists for a `(user_id, organization_id, event_type)`
tuple, the system uses the default email mode for that event type (see the event type table above).
Preferences are created lazily on first user customisation.

# Interfaces

## Effect Ports

Following the established port pattern (see `BillingStorePort` in
`packages/core/src/domains/billing/ports/billing-ports.ts`), the notification domain exposes four
ports.

### NotificationStorePort

```typescript
import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type {
  NotificationRecord,
  CreateNotificationCommand,
  NotificationEventType
} from '../domain/notification-domain.js'

export class NotificationStorePort extends Context.Tag('NotificationStorePort')<
  NotificationStorePort,
  {
    create: (
      input: CreateNotificationCommand
    ) => Effect.Effect<NotificationRecord, unknown>

    createBatch: (
      inputs: ReadonlyArray<CreateNotificationCommand>
    ) => Effect.Effect<ReadonlyArray<NotificationRecord>, unknown>

    findById: (id: string) => Effect.Effect<NotificationRecord | null, unknown>

    listForUser: (
      input: {
        userId: string
        organizationId: string
        unreadOnly?: boolean
        limit?: number
        cursor?: string
      }
    ) => Effect.Effect<ReadonlyArray<NotificationRecord>, unknown>

    markRead: (
      id: string,
      userId: string
    ) => Effect.Effect<NotificationRecord | null, unknown>

    markAllRead: (
      userId: string,
      organizationId: string
    ) => Effect.Effect<number, unknown>

    findPendingDigest: (
      digestBatchId: string
    ) => Effect.Effect<ReadonlyArray<NotificationRecord>, unknown>

    findUnmailedDigestNotifications: (
      input: {
        userId: string
        organizationId: string
      }
    ) => Effect.Effect<ReadonlyArray<NotificationRecord>, unknown>

    markEmailed: (
      ids: ReadonlyArray<string>,
      emailedAt: Date
    ) => Effect.Effect<number, unknown>

    deleteOlderThan: (
      cutoffDate: Date
    ) => Effect.Effect<number, unknown>

    countUnread: (
      userId: string,
      organizationId: string
    ) => Effect.Effect<number, unknown>
  }
>() {}
```

### NotificationPreferenceStorePort

```typescript
import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type {
  NotificationPreferenceRecord,
  EmailMode,
  NotificationEventType
} from '../domain/notification-domain.js'

export class NotificationPreferenceStorePort extends Context.Tag('NotificationPreferenceStorePort')<
  NotificationPreferenceStorePort,
  {
    findForUser: (
      userId: string,
      organizationId: string
    ) => Effect.Effect<ReadonlyArray<NotificationPreferenceRecord>, unknown>

    findOne: (
      userId: string,
      organizationId: string,
      eventType: NotificationEventType
    ) => Effect.Effect<NotificationPreferenceRecord | null, unknown>

    upsert: (
      input: {
        userId: string
        organizationId: string
        eventType: NotificationEventType
        emailMode: EmailMode
      }
    ) => Effect.Effect<NotificationPreferenceRecord, unknown>

    upsertBatch: (
      inputs: ReadonlyArray<{
        userId: string
        organizationId: string
        eventType: NotificationEventType
        emailMode: EmailMode
      }>
    ) => Effect.Effect<ReadonlyArray<NotificationPreferenceRecord>, unknown>
  }
>() {}
```

### EmailDeliveryPort

```typescript
import { Context } from 'effect'
import type * as Effect from 'effect/Effect'

export class EmailDeliveryPort extends Context.Tag('EmailDeliveryPort')<
  EmailDeliveryPort,
  {
    send: (
      input: {
        to: string
        subject: string
        htmlBody: string
        textBody?: string
        replyTo?: string
      }
    ) => Effect.Effect<{ messageId: string }, unknown>

    sendBatch: (
      inputs: ReadonlyArray<{
        to: string
        subject: string
        htmlBody: string
        textBody?: string
      }>
    ) => Effect.Effect<ReadonlyArray<{ messageId: string }>, unknown>
  }
>() {}
```

### NotificationService

Application-layer service that orchestrates dispatch logic. Consumed by other subsystems (billing,
campaigns, publishing) to fire notifications.

```typescript
import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { NotificationEventType } from '../domain/notification-domain.js'

export class NotificationService extends Context.Tag('NotificationService')<
  NotificationService,
  {
    /**
     * Primary entry point. Called by domain event handlers.
     * Resolves recipients, checks preferences, creates in-app notifications,
     * and dispatches email (immediate or digest).
     */
    dispatch: (
      input: {
        organizationId: string
        eventType: NotificationEventType
        title: string
        body: string
        metadata?: Record<string, unknown>
        recipientUserIds?: ReadonlyArray<string>
        recipientEmails?: ReadonlyArray<string>
      }
    ) => Effect.Effect<void, unknown>

    /**
     * Convenience method used in billing/campaign code.
     * Equivalent to dispatch with a single org and event type.
     */
    notify: (
      organizationId: string,
      eventType: NotificationEventType
    ) => Effect.Effect<void, unknown>

    /**
     * Notify the manager of a specific campaign.
     */
    notifyCampaignManager: (
      campaignId: string,
      eventType: NotificationEventType
    ) => Effect.Effect<void, unknown>

    /**
     * Process a digest batch for a specific user + org.
     * Called by the DigestBatchWorkflow.
     */
    processDigest: (
      userId: string,
      organizationId: string
    ) => Effect.Effect<void, unknown>
  }
>() {}
```

## API Routes

All routes are org-scoped and require authentication.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/organizations/:orgId/notifications` | List notifications for current user (paginated, cursor-based). Query params: `unread_only`, `limit`, `cursor`. |
| `GET` | `/organizations/:orgId/notifications/unread-count` | Return `{ count: number }` for badge display. |
| `PATCH` | `/organizations/:orgId/notifications/:id/read` | Mark a single notification as read. |
| `POST` | `/organizations/:orgId/notifications/mark-all-read` | Mark all notifications as read for current user in this org. |
| `GET` | `/organizations/:orgId/notification-preferences` | List all preferences for current user in this org. Returns defaults for event types without explicit preferences. |
| `PUT` | `/organizations/:orgId/notification-preferences` | Bulk upsert preferences. Body: `{ preferences: [{ eventType, emailMode }] }`. |

## Temporal Workflows

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `NotificationDispatchWorkflow` | On-demand (started by domain event handler) | Resolve recipients, create in-app notifications, dispatch immediate emails |
| `DigestBatchWorkflow` | Daily at 08:00 org timezone | Collect unmailed digest notifications, render and send digest email per user |
| `NotificationRetentionWorkflow` | Weekly (Sunday 03:00 UTC) | Delete notifications older than 90 days |

## Temporal Activities

| Activity | Purpose |
|----------|---------|
| `resolveRecipientsActivity` | Query org members / campaign managers / account owners based on event type |
| `createNotificationsActivity` | Batch insert into `notifications` table |
| `sendEmailActivity` | Render template and send via `EmailDeliveryPort` |
| `processDigestActivity` | Query pending digest notifications, render digest template, send, mark emailed |
| `pruneNotificationsActivity` | Delete rows older than retention cutoff |

# Invariants

```yaml
invariants:
  - id: INV-NOTIF-001
    statement: >
      In-app notifications are always created for every event type regardless of email
      preference settings. Email mode (immediate/digest/off) only controls the email
      channel. Users cannot disable in-app notifications.
    severity: high
    verified_by:
      - REQ-NOTIF-001

  - id: INV-NOTIF-002
    statement: >
      Notification dispatch is idempotent per domain event. The outbox event ID is stored
      in `notifications.metadata.outbox_event_id`. If a notification with the same
      `outbox_event_id` already exists for a recipient, the dispatch is skipped or the
      existing row is returned. This prevents duplicate notifications on Temporal workflow
      retries and concurrent worker fan-out races.
    severity: critical
    verified_by:
      - REQ-NOTIF-002

  - id: INV-NOTIF-003
    statement: >
      Digest emails are never sent with zero notifications. The DigestBatchWorkflow skips
      users with no pending digest notifications rather than sending an empty email.
    severity: medium
    verified_by:
      - REQ-NOTIF-003

  - id: INV-NOTIF-004
    statement: >
      Notification preferences use lazy creation with deterministic defaults. If no
      preference row exists for a (user_id, organization_id, event_type) tuple, the
      system uses the default email mode defined in the event type registry. Preferences
      are only persisted when a user explicitly changes them.
    severity: high
    verified_by:
      - REQ-NOTIF-004

  - id: INV-NOTIF-005
    statement: >
      Email delivery failures do not block in-app notification creation. The notification
      row is created before the email send is attempted. If email rendering or delivery
      fails, the notification still exists in-app and the failure is logged.
    severity: high
    verified_by:
      - REQ-NOTIF-005

  - id: INV-NOTIF-006
    statement: >
      Notifications are org-scoped. A user can only read notifications for organizations
      they are a member of. The API enforces this via org membership check on every
      request. Cross-org notification leakage is a security violation.
    severity: critical
    verified_by:
      - REQ-NOTIF-006

  - id: INV-NOTIF-007
    statement: >
      The `notifications` table has a 90-day retention policy. Rows older than 90 days
      are deleted by the NotificationRetentionWorkflow. Notifications are not financial
      records and are safe to delete. This prevents unbounded table growth.
    severity: medium
    verified_by:
      - REQ-NOTIF-007

  - id: INV-NOTIF-008
    statement: >
      `org.invitation_sent` is the only event type that delivers email to non-users
      (by email address rather than user ID). All other event types require the recipient
      to be a registered user with a `user_id`. The EmailDeliveryPort accepts a raw email
      address for this case.
    severity: high
    verified_by:
      - REQ-NOTIF-008
```

# Failure Modes

```yaml
failure_modes:
  - condition: Email provider (Resend) is down or returns 5xx errors
    impact: >
      Immediate emails are not delivered. Users miss time-sensitive notifications such as
      publish failures, payment failures, and usage cap alerts. In-app notifications are
      unaffected.
    handling: >
      Phase 1 billing fan-out creates the in-app notification first, then attempts the billing
      email and catches/logs delivery errors. The user still sees the in-app notification.
      Phase 2 can add separate email retry/dead-letter state if operational telemetry shows
      provider failures need replay rather than alerting only.

  - condition: DigestBatchWorkflow fails mid-execution (e.g., worker crash)
    impact: >
      Some users receive their digest email while others do not. Users who missed the
      digest still have in-app notifications and will receive the missed items in the
      next day's digest.
    handling: >
      The workflow is idempotent -- `emailed_at` is set per notification row after
      successful send. On retry, already-emailed notifications are excluded. The workflow
      picks up where it left off. Temporal's built-in retry ensures completion.

  - condition: Recipient resolution returns zero users (e.g., org has no admins)
    impact: >
      The notification event is silently dropped. No in-app or email notification is
      created. This could cause critical alerts (payment failure, usage cap) to go unnoticed.
    handling: >
      Log a warning with the event type and organization ID. The system should never have
      an org with zero admins (enforced by the tenancy subsystem), but if it does, the
      warning surfaces the issue for ops investigation.

  - condition: Notification table grows unbounded due to retention workflow failure
    impact: >
      Query performance degrades for the notification feed. The `(user_id, organization_id,
      created_at DESC)` index becomes bloated, slowing page loads.
    handling: >
      The retention workflow runs weekly with alerting on failure. If the workflow has not
      completed successfully in 14 days, an ops alert fires. Manual cleanup can be run via
      `DELETE FROM notifications WHERE created_at < now() - interval '90 days'`.

  - condition: High-frequency events (e.g., bulk publish) flood the notification table
    impact: >
      Users receive hundreds of individual in-app notifications for a single campaign batch.
      The digest email becomes unusably long.
    handling: >
      Campaign batch events are pre-aggregated by the publishing workflow. Instead of
      emitting N individual `post.publish_success` events, the nightly batch emits a single
      `campaign.morning_summary` event with aggregate counts. Individual per-post events
      are only emitted for failures. The digest renderer groups by event type and collapses
      repeated events with a count.

  - condition: User has preferences for an event type that has been deprecated or renamed
    impact: >
      The preference row references a non-existent event type. Notification dispatch ignores
      it (no match), and the preferences UI shows a stale entry.
    handling: >
      Event type validation is enforced at the application layer. Deprecated event types are
      handled via a migration that removes stale preference rows. The preferences API rejects
      unknown event types on upsert.
```

# Verification

```yaml
verification:
  - requirement_id: REQ-NOTIF-001
    test_type: integration
    target: >
      Dispatch a notification event with email mode set to `off` for the recipient.
      Verify that an in-app notification row was created in the `notifications` table
      and that no email was sent (EmailDeliveryPort not called).

  - requirement_id: REQ-NOTIF-002
    test_type: integration
    target: >
      Dispatch the same domain event (same outbox_event_id) twice for the same recipient.
      Verify that only one notification row exists in the `notifications` table. The second
      dispatch should be a no-op.

  - requirement_id: REQ-NOTIF-003
    test_type: integration
    target: >
      Run the DigestBatchWorkflow for a user with zero pending digest notifications.
      Verify that EmailDeliveryPort.send was not called and no digest email was sent.

  - requirement_id: REQ-NOTIF-004
    test_type: unit
    target: >
      For each of the 18 event types, verify that when no preference row exists the
      system returns the correct default email mode as specified in the event type
      registry.

  - requirement_id: REQ-NOTIF-005
    test_type: integration
    target: >
      Dispatch a notification with email mode `immediate`. Stub EmailDeliveryPort to
      fail on all attempts. Verify that the in-app notification row was created
      successfully and that the email failure is logged without throwing from the handler.

  - requirement_id: REQ-NOTIF-006
    test_type: integration
    target: >
      Create notifications for two different organizations. Authenticate as a user who
      is a member of org A but not org B. Request notifications for org B and verify
      the API returns 403 Forbidden.

  - requirement_id: REQ-NOTIF-007
    test_type: integration
    target: >
      Insert notifications with `created_at` older than 90 days and newer than 90 days.
      Run the NotificationRetentionWorkflow. Verify that only the old notifications were
      deleted and recent notifications remain.

  - requirement_id: REQ-NOTIF-008
    test_type: integration
    target: >
      Dispatch an `org.invitation_sent` event with a recipient email address (no user_id).
      Verify that an email was sent to the provided email address via EmailDeliveryPort
      and that no in-app notification was created (since there is no user account yet).
```
