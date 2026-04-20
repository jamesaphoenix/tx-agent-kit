import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { BillingService, CreditLedgerStorePort, CreditServicePort } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { BadRequest, Forbidden, TxAgentApi, mapCoreError } from '../api.js'
import { getApiEnv } from '../config/env.js'
import { toApiBillingSettings } from '../mappers/billing-mapper.js'
import { checkBillingRateLimit } from '../middleware/billing-rate-limit.js'
import { requireAuth } from '../utils.js'

export const BillingRouteKind = 'custom' as const

const parseDateValue = (
  value: string | undefined,
  fallback: Date,
  label: string
): Effect.Effect<Date, BadRequest> => {
  if (!value) {
    return Effect.succeed(fallback)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return Effect.fail(new BadRequest({ message: `Invalid ${label} date` }))
  }

  return Effect.succeed(parsed)
}

export const BillingLive = HttpApiBuilder.group(TxAgentApi, 'billing', (handlers) =>
  handlers
    .handle('getBillingSettings', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const billingService = yield* BillingService
        const settings = yield* billingService.getBillingSettings(principal, path.organizationId).pipe(
          Effect.mapError(mapCoreError)
        )
        return toApiBillingSettings(settings)
      })
    )
    .handle('updateBillingSettings', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const billingService = yield* BillingService
        const settings = yield* billingService.updateBillingSettings(principal, path.organizationId, payload).pipe(
          Effect.mapError(mapCoreError)
        )
        return toApiBillingSettings(settings)
      })
    )
    .handle('createCheckoutSession', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        // Per-org rate limit: each of these handlers calls Stripe
        // and each Stripe call costs money. Bucket by org so
        // unrelated tenants don't share a budget; the limit is
        // intentionally generous (10/min) so genuine users aren't
        // blocked by a spam-click.
        yield* checkBillingRateLimit('createCheckoutSession', payload.organizationId)
        const billingService = yield* BillingService
        return yield* billingService.createCheckoutSession(principal, payload).pipe(
          Effect.mapError(mapCoreError)
        )
      })
    )
    .handle('createPortalSession', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        yield* checkBillingRateLimit('createPortalSession', payload.organizationId)
        const billingService = yield* BillingService
        return yield* billingService.createPortalSession(principal, payload).pipe(
          Effect.mapError(mapCoreError)
        )
      })
    )
    .handle('createTopUpSession', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        yield* checkBillingRateLimit('createTopUpSession', path.organizationId)
        const billingService = yield* BillingService
        return yield* billingService.createTopUpSession(principal, {
          organizationId: path.organizationId,
          amountDecimillicents: payload.amountDecimillicents,
          successUrl: payload.successUrl,
          cancelUrl: payload.cancelUrl
        }).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('completeLocalBillingSetup', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const nodeEnv = getApiEnv().NODE_ENV

        if (nodeEnv === 'production' || nodeEnv === 'staging') {
          return yield* Effect.fail(new Forbidden({
            message: 'Local billing bootstrap is only available in development and test environments'
          }))
        }

        const billingService = yield* BillingService
        const settings = yield* billingService
          .completeLocalBillingSetup(principal, path.organizationId, payload)
          .pipe(Effect.mapError(mapCoreError))

        return toApiBillingSettings(settings)
      })
    )
    .handle('getUsageSummary', ({ path, urlParams }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const billingService = yield* BillingService
        const now = new Date()
        const defaultStart = new Date(now.getTime() - (1000 * 60 * 60 * 24 * 30))
        const periodStart = yield* parseDateValue(urlParams.periodStart, defaultStart, 'periodStart')
        const periodEnd = yield* parseDateValue(urlParams.periodEnd, now, 'periodEnd')

        if (periodEnd.getTime() < periodStart.getTime()) {
          return yield* Effect.fail(new BadRequest({ message: 'periodEnd must be >= periodStart' }))
        }

        // Cap the query window to 92 days (~quarterly). usage_records is
        // a 7-year audit table — without an upper bound, a caller could
        // ask for a 7-year SUM aggregate and force a slow scan that
        // doubles as a DoS amplifier (sustained concurrent calls would
        // chew Postgres CPU). Quarterly windows are the largest period
        // the UI exposes; clients that need historical data should
        // paginate over multiple windows.
        const MAX_USAGE_SUMMARY_WINDOW_MS = 92 * 24 * 60 * 60 * 1000
        if (periodEnd.getTime() - periodStart.getTime() > MAX_USAGE_SUMMARY_WINDOW_MS) {
          return yield* Effect.fail(new BadRequest({
            message: 'usage summary window must be at most 92 days; paginate over smaller ranges for historical data'
          }))
        }

        const summary = yield* billingService.getUsageSummary(principal, {
          organizationId: path.organizationId,
          category: urlParams.category,
          periodStart,
          periodEnd
        }).pipe(Effect.mapError(mapCoreError))

        return {
          organizationId: summary.organizationId,
          category: summary.category,
          periodStart: summary.periodStart.toISOString(),
          periodEnd: summary.periodEnd.toISOString(),
          totalQuantity: summary.totalQuantity,
          totalCostDecimillicents: summary.totalCostDecimillicents
        }
      })
    )
    .handle('getCreditBalance', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const billingService = yield* BillingService
        // The auth check returns the BillingSettings record, which now
        // carries suspendedAt (introduced with the credit-positive
        // re-evaluation pattern). Read it directly so we don't have to
        // double-read the org row.
        const settings = yield* billingService.getBillingSettings(principal, path.organizationId).pipe(
          Effect.mapError(mapCoreError)
        )
        const creditService = yield* CreditServicePort
        const balance = yield* creditService.getAvailableBalance(path.organizationId).pipe(
          Effect.mapError(mapCoreError)
        )
        // `isSuspended` reflects the REAL ability to reserve credits — the
        // billing repo's `failIfSuspended` guard rejects new reserves when
        // EITHER `suspended_at` OR `payment_grace_period_ends_at` is set.
        // UI consumers should treat either as "operations blocked". The
        // underlying timestamps are surfaced separately so the frontend
        // can render the right message (usage cap vs. payment required).
        const gracePeriodEndsAt = settings.paymentGracePeriodEndsAt ?? null
        return {
          creditsBalanceDecimillicents: balance.creditsBalance,
          reservedCreditsDecimillicents: balance.reservedCredits,
          availableDecimillicents: balance.available,
          isSuspended: settings.suspendedAt !== null || gracePeriodEndsAt !== null,
          suspendedAt: settings.suspendedAt ? settings.suspendedAt.toISOString() : null,
          paymentGracePeriodEndsAt: gracePeriodEndsAt ? gracePeriodEndsAt.toISOString() : null
        }
      })
    )
    .handle('getCreditHistory', ({ path, urlParams }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const billingService = yield* BillingService
        yield* billingService.getBillingSettings(principal, path.organizationId).pipe(
          Effect.mapError(mapCoreError)
        )

        // Validate the cursor as a UUID before passing it to the repo.
        // The compound-keyset lookup in listForOrganization casts the
        // cursor to ::uuid in the SQL — an invalid string would surface
        // as a 500 Postgres parse error instead of a clean 400.
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (urlParams.cursor !== undefined && !uuidPattern.test(urlParams.cursor)) {
          return yield* Effect.fail(new BadRequest({ message: 'cursor must be a valid UUID' }))
        }

        const limit = Math.min(Math.max(Number(urlParams.limit) || 50, 1), 100)
        const creditLedgerStore = yield* CreditLedgerStorePort
        const entries = yield* creditLedgerStore.listForOrganization({
          organizationId: path.organizationId,
          limit: limit + 1,
          cursor: urlParams.cursor
        }).pipe(Effect.mapError(mapCoreError))

        const hasMore = entries.length > limit
        const page = hasMore ? entries.slice(0, limit) : entries
        const lastItem = page[page.length - 1]

        return {
          items: page.map((entry) => ({
            id: entry.id,
            entryType: entry.entryType,
            amountDecimillicents: entry.amountDecimillicents,
            reason: entry.reason,
            referenceId: entry.referenceId,
            balanceAfter: entry.balanceAfter,
            createdAt: entry.createdAt.toISOString()
          })),
          cursor: hasMore && lastItem ? lastItem.id : null,
          hasMore
        }
      })
    )
    .handle('getNoCapReminder', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const billingService = yield* BillingService
        return yield* billingService.getNoCapReminderPreference(principal, path.organizationId).pipe(
          Effect.mapError(mapCoreError)
        )
      })
    )
    .handle('dismissNoCapReminder', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const billingService = yield* BillingService
        return yield* billingService.dismissNoCapReminder(principal, path.organizationId).pipe(
          Effect.mapError(mapCoreError)
        )
      })
    )
    .handle('getAutoRechargeRequiresAction', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const billingService = yield* BillingService
        return yield* billingService.getAutoRechargeRequiresActionChallenge(principal, path.organizationId).pipe(
          Effect.mapError(mapCoreError)
        )
      })
    )
    .handle('stripeWebhook', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const signature = request.headers['stripe-signature']
        if (!signature) {
          return yield* Effect.fail(new BadRequest({ message: 'Missing stripe-signature header' }))
        }

        const billingService = yield* BillingService
        const rawBody = yield* request.text.pipe(
          Effect.mapError((cause) => new BadRequest({ message: `Failed to read webhook request body: ${cause instanceof Error ? cause.message : String(cause)}` }))
        )
        return yield* billingService.processWebhookEvent(rawBody, signature).pipe(
          Effect.mapError(mapCoreError)
        )
      })
    )
)
