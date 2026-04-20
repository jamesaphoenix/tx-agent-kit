/**
 * Billing notification fan-out handler.
 *
 * Consumes a `billing.*` domain event from the transactional outbox and
 * dispatches BOTH an in-app notification (via `notificationsRepository`)
 * and an email (via `BillingEmailPort`). Idempotency lives in
 * `notifications.metadata.outbox_event_id` — a second call for the same
 * event id short-circuits to a no-op before touching either channel.
 *
 * @spec notifications-design §"Scope boundary with billing"
 * @spec INV-NOTIF-005 — email failures must not block in-app creation
 * @spec INV-NOTIF-002 — dispatch is idempotent per outbox event id
 */
import {
  notificationsRepository,
  organizationsRepository,
  usersRepository
} from '@tx-agent-kit/db'
import { BillingEmailPort } from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect, Option } from 'effect'
import type { Layer } from 'effect'
import type { SerializedDomainEvent } from './activities.js'
import { getWorkerWebBaseUrl } from './config/env.js'

const logger = createLogger('tx-agent-kit-worker-billing-notifications')

type HandlerContext = {
  readonly billingEmailLayer: Layer.Layer<BillingEmailPort>
}

interface ResolvedRecipient {
  readonly userId: string
  readonly email: string
  readonly name: string
}

const resolveOwner = (
  organizationId: string
): Effect.Effect<ResolvedRecipient | null, unknown> =>
  Effect.gen(function* () {
    const maybeOrg = yield* organizationsRepository.getById(organizationId)
    if (Option.isNone(maybeOrg)) {
      return null
    }
    const org = maybeOrg.value
    if (!org.ownerUserId) {
      return null
    }
    // Phase 1 recipient resolution: the org owner. Admins-only fan-out
    // is a Phase 2 concern — the spec's recipient matrix uses "org
    // admins" but Phase 1 ships with owner-only to keep the initial
    // wiring deterministic.
    const ownerRow = yield* usersRepository.findById(org.ownerUserId)
    if (Option.isNone(ownerRow)) {
      return null
    }
    const user = ownerRow.value
    const email = org.billingEmail ?? user.email
    const name = user.name
    return { userId: user.id, email, name }
  })

const formatUsd = (decimillicents: number): string => {
  const dollars = decimillicents / 10_000_000
  return `$${dollars.toFixed(2)}`
}

const defaultWebBaseUrl = 'https://tx-agent-kit.local'

const buildOrgUrl = (organizationId: string, path: string): string => {
  const baseUrl = (getWorkerWebBaseUrl() ?? defaultWebBaseUrl).replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}/org/${encodeURIComponent(organizationId)}${normalizedPath}`
}

const formatGracePeriodEndsAtDisplay = (value: unknown): string => {
  if (typeof value !== 'string') {
    return 'in 7 days'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'in 7 days'
  }
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

/**
 * Short synchronous mapping from billing event type → in-app notification
 * title + body. Keeps per-event copy in one place so Phase 2 can replace
 * with template-driven content without touching the dispatch path.
 */
const notificationContent = (
  event: SerializedDomainEvent
): { title: string; body: string } => {
  switch (event.eventType) {
    case 'billing.welcome_credit_granted': {
      const amount = typeof event.payload.amountDecimillicents === 'number'
        ? formatUsd(event.payload.amountDecimillicents)
        : 'your welcome credit'
      return {
        title: 'Welcome credit granted',
        body: `We added ${amount} to your wallet as a welcome bonus. Credits never expire — take your time using them.`
      }
    }
    case 'billing.credits_purchased': {
      const amount = typeof event.payload.amountDecimillicents === 'number'
        ? formatUsd(event.payload.amountDecimillicents)
        : 'your top-up'
      return { title: 'Top-up confirmed', body: `Your ${amount} top-up landed in your wallet.` }
    }
    case 'billing.credits_recharged': {
      const amount = typeof event.payload.amountDecimillicents === 'number'
        ? formatUsd(event.payload.amountDecimillicents)
        : 'credits'
      return {
        title: 'Auto-recharge succeeded',
        body: `Auto-recharge added ${amount} to your tx-agent-kit wallet.`
      }
    }
    case 'billing.credits_refunded': {
      const amount = typeof event.payload.amountDecimillicents === 'number'
        ? formatUsd(event.payload.amountDecimillicents)
        : 'credits'
      return { title: 'Refund processed', body: `A refund of ${amount} was applied to your account.` }
    }
    case 'billing.credits_low_balance': {
      const current = typeof event.payload.currentBalanceDecimillicents === 'number'
        ? formatUsd(event.payload.currentBalanceDecimillicents)
        : 'your balance'
      return {
        title: 'Credit balance is running low',
        body: `Your available balance is ${current}. Top up now to avoid interruptions.`
      }
    }
    case 'billing.usage_cap_warning': {
      const percent = typeof event.payload.percentUsed === 'number'
        ? event.payload.percentUsed
        : 0
      return {
        title: `Usage cap at ${percent}%`,
        body: `You are at ${percent}% of your monthly usage cap.`
      }
    }
    case 'billing.usage_cap_exceeded': {
      return {
        title: 'Monthly usage cap reached',
        body: 'You have hit your monthly usage cap. New AI operations are paused until the period resets or you raise the cap.'
      }
    }
    case 'billing.payment_failed': {
      return {
        title: 'Subscription payment failed',
        body: 'Your most recent subscription payment failed. Update your payment method to avoid interruption.'
      }
    }
    case 'billing.dispute_created': {
      return {
        title: 'Payment dispute filed',
        body: 'A chargeback dispute was filed on your account. Your credit balance is temporarily frozen while we investigate.'
      }
    }
    case 'billing.dispute_resolved': {
      const outcome = event.payload.outcome === 'won' || event.payload.outcome === 'lost'
        ? event.payload.outcome
        : 'resolved'
      return {
        title: `Dispute ${outcome}`,
        body: `Your payment dispute was ${outcome}.`
      }
    }
    case 'billing.subscription_cancelled': {
      return {
        title: 'Subscription cancelled',
        body: 'Your subscription has been cancelled. Remaining credits never expire.'
      }
    }
    case 'billing.recharge_requires_action': {
      return {
        title: 'Bank verification required',
        body: 'Your bank has asked for additional verification on an auto-recharge charge. Follow the link in the email to complete the challenge.'
      }
    }
    default: {
      return {
        title: 'Billing update',
        body: `A new billing event occurred: ${event.eventType}.`
      }
    }
  }
}

/**
 * Dispatch the email channel for a billing event. Best-effort: failures
 * are caught and logged but never bubble up past this function, so they
 * cannot block the in-app notification creation. INV-NOTIF-005.
 */
const sendBillingEmail = (
  event: SerializedDomainEvent,
  recipient: ResolvedRecipient,
  organizationId: string
): Effect.Effect<void, never, BillingEmailPort> =>
  Effect.gen(function* () {
    const port = yield* BillingEmailPort
    switch (event.eventType) {
      case 'billing.welcome_credit_granted': {
        const amount = typeof event.payload.amountDecimillicents === 'number'
          ? formatUsd(event.payload.amountDecimillicents)
          : '$0'
        const plan = typeof event.payload.plan === 'string' ? event.payload.plan : 'tx-agent-kit'
        yield* port.sendWelcomeCreditGranted({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          amountUsd: amount,
          planDisplayName: plan,
          dashboardUrl: buildOrgUrl(organizationId, '/billing')
        })
        return
      }
      case 'billing.credits_purchased': {
        const amount = typeof event.payload.amountDecimillicents === 'number'
          ? formatUsd(event.payload.amountDecimillicents)
          : '$0'
        yield* port.sendCreditsPurchased({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          amountUsd: amount,
          newBalanceUsd: amount,
          dashboardUrl: buildOrgUrl(organizationId, '/billing')
        })
        return
      }
      case 'billing.credits_recharged': {
        const amount = typeof event.payload.amountDecimillicents === 'number'
          ? formatUsd(event.payload.amountDecimillicents)
          : '$0'
        yield* port.sendCreditsRecharged({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          amountUsd: amount,
          newBalanceUsd: amount,
          dashboardUrl: buildOrgUrl(organizationId, '/billing')
        })
        return
      }
      case 'billing.credits_refunded': {
        const amount = typeof event.payload.amountDecimillicents === 'number'
          ? formatUsd(event.payload.amountDecimillicents)
          : '$0'
        yield* port.sendCreditsRefunded({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          amountUsd: amount,
          dashboardUrl: buildOrgUrl(organizationId, '/billing/history')
        })
        return
      }
      case 'billing.credits_low_balance': {
        const current = typeof event.payload.currentBalanceDecimillicents === 'number'
          ? formatUsd(event.payload.currentBalanceDecimillicents)
          : '$0'
        const threshold = typeof event.payload.thresholdDecimillicents === 'number'
          ? formatUsd(event.payload.thresholdDecimillicents)
          : '$0'
        yield* port.sendCreditsLowBalance({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          currentBalanceUsd: current,
          thresholdUsd: threshold,
          topUpUrl: buildOrgUrl(organizationId, '/billing?topup=1')
        })
        return
      }
      case 'billing.usage_cap_warning': {
        const percent = typeof event.payload.percentUsed === 'number'
          ? event.payload.percentUsed
          : 80
        const cap = typeof event.payload.capDecimillicents === 'number'
          ? formatUsd(event.payload.capDecimillicents)
          : '$0'
        yield* port.sendUsageCapWarning({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          percentUsed: percent,
          capUsd: cap,
          dashboardUrl: buildOrgUrl(organizationId, '/billing/usage')
        })
        return
      }
      case 'billing.usage_cap_exceeded': {
        const cap = typeof event.payload.capDecimillicents === 'number'
          ? formatUsd(event.payload.capDecimillicents)
          : '$0'
        yield* port.sendUsageCapExceeded({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          capUsd: cap,
          dashboardUrl: buildOrgUrl(organizationId, '/billing/settings')
        })
        return
      }
      case 'billing.payment_failed': {
        yield* port.sendPaymentFailed({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          gracePeriodEndsAtDisplay: formatGracePeriodEndsAtDisplay(event.payload.gracePeriodEndsAt),
          updatePaymentUrl: buildOrgUrl(organizationId, '/billing/settings')
        })
        return
      }
      case 'billing.dispute_created': {
        const amount = typeof event.payload.chargeAmountDecimillicents === 'number'
          ? formatUsd(event.payload.chargeAmountDecimillicents)
          : '$0'
        yield* port.sendDisputeCreated({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          chargeAmountUsd: amount,
          supportUrl: 'mailto:support@tx-agent-kit.local'
        })
        return
      }
      case 'billing.subscription_cancelled': {
        yield* port.sendSubscriptionCancelled({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          dashboardUrl: buildOrgUrl(organizationId, '/billing')
        })
        return
      }
      case 'billing.recharge_requires_action': {
        const amount = typeof event.payload.amountDecimillicents === 'number'
          ? formatUsd(event.payload.amountDecimillicents)
          : '$0'
        yield* port.sendRechargeRequiresAction({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          amountUsd: amount,
          challengeUrl: buildOrgUrl(organizationId, '/billing')
        })
        return
      }
      default: {
        // No email for unmapped event types (e.g. dispute_resolved informational).
        return
      }
    }
  }).pipe(
    // Email failures must never block in-app notification creation.
    Effect.catchAll((error) =>
      Effect.sync(() => {
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error(
          'Billing notification email delivery failed.',
          {
            eventId: event.id,
            eventType: event.eventType,
            organizationId,
            userId: recipient.userId
          },
          normalized
        )
      })
    )
  )

/**
 * Fan out a billing domain event to the notifications + email channels.
 * Idempotent per outbox event id — a second call with the same event.id
 * short-circuits before writing anything.
 */
export const fanOutBillingEvent = (
  event: SerializedDomainEvent,
  ctx: HandlerContext
): Effect.Effect<{ createdNotification: boolean }, unknown> =>
  Effect.gen(function* () {
    const organizationId = typeof event.payload.organizationId === 'string'
      ? event.payload.organizationId
      : null
    if (!organizationId) {
      return { createdNotification: false }
    }

    const recipient = yield* resolveOwner(organizationId)
    if (!recipient) {
      return { createdNotification: false }
    }

    // Idempotency: indexed point lookup against the partial UNIQUE
    // index on (user_id, organization_id, metadata->>'outbox_event_id')
    // added in migration 0048. The previous Phase 1 implementation
    // scanned the user's most recent 50 notifications in memory, which
    // silently missed dedups for any user with more than 50 rows and
    // produced duplicate notifications on retry — violating
    // INV-NOTIF-002.
    const existing = yield* notificationsRepository.findByOutboxEventId({
      userId: recipient.userId,
      organizationId,
      outboxEventId: event.id
    })
    if (existing) {
      return { createdNotification: false }
    }

    const { title, body } = notificationContent(event)
    const created = yield* notificationsRepository.createIdempotent({
      organizationId,
      userId: recipient.userId,
      eventType: event.eventType,
      title,
      body,
      metadata: { outbox_event_id: event.id, event_type: event.eventType }
    })
    if (!created) {
      return { createdNotification: false }
    }

    // Email channel — provide the Live layer, swallow failures per
    // INV-NOTIF-005 so a bad email delivery never blocks the in-app row.
    yield* sendBillingEmail(event, recipient, organizationId).pipe(Effect.provide(ctx.billingEmailLayer))

    return { createdNotification: true }
  })
