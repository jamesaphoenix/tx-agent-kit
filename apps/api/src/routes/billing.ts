import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization, BillingService } from '@tx-agent-kit/core'
import type { SubscriptionStatus } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'

export const BillingRouteKind = 'custom' as const

const parseDateValue = (value: string | undefined, fallback: Date, label: string): Date => {
  if (!value) {
    return fallback
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequest({ message: `Invalid ${label} date` })
  }

  return parsed
}

const toApiBillingSettings = (settings: {
  organizationId: string
  billingEmail: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePaymentMethodId: string | null
  stripeMeteredSubscriptionItemId: string | null
  creditsBalanceDecimillicents: number
  reservedCreditsDecimillicents: number
  autoRechargeEnabled: boolean
  autoRechargeThresholdDecimillicents: number | null
  autoRechargeAmountDecimillicents: number | null
  isSubscribed: boolean
  subscriptionStatus: SubscriptionStatus
  subscriptionPlan: 'pro' | null
  subscriptionStartedAt: Date | null
  subscriptionEndsAt: Date | null
  subscriptionCurrentPeriodEnd: Date | null
}) => ({
  organizationId: settings.organizationId,
  billingEmail: settings.billingEmail,
  stripeCustomerId: settings.stripeCustomerId,
  stripeSubscriptionId: settings.stripeSubscriptionId,
  stripePaymentMethodId: settings.stripePaymentMethodId,
  stripeMeteredSubscriptionItemId: settings.stripeMeteredSubscriptionItemId,
  creditsBalanceDecimillicents: settings.creditsBalanceDecimillicents,
  reservedCreditsDecimillicents: settings.reservedCreditsDecimillicents,
  autoRechargeEnabled: settings.autoRechargeEnabled,
  autoRechargeThresholdDecimillicents: settings.autoRechargeThresholdDecimillicents,
  autoRechargeAmountDecimillicents: settings.autoRechargeAmountDecimillicents,
  isSubscribed: settings.isSubscribed,
  subscriptionStatus: settings.subscriptionStatus,
  subscriptionPlan: settings.subscriptionPlan,
  subscriptionStartedAt: settings.subscriptionStartedAt?.toISOString() ?? null,
  subscriptionEndsAt: settings.subscriptionEndsAt?.toISOString() ?? null,
  subscriptionCurrentPeriodEnd: settings.subscriptionCurrentPeriodEnd?.toISOString() ?? null
})

export const BillingLive = HttpApiBuilder.group(TxAgentApi, 'billing', (handlers) =>
  handlers
    .handle('getBillingSettings', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )
        const billingService = yield* BillingService
        const settings = yield* billingService.getBillingSettings(principal, path.organizationId).pipe(
          Effect.mapError(mapCoreError)
        )
        return toApiBillingSettings(settings)
      })
    )
    .handle('updateBillingSettings', ({ path, payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )
        const billingService = yield* BillingService
        const settings = yield* billingService.updateBillingSettings(principal, path.organizationId, payload).pipe(
          Effect.mapError(mapCoreError)
        )
        return toApiBillingSettings(settings)
      })
    )
    .handle('createCheckoutSession', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )
        const billingService = yield* BillingService
        return yield* billingService.createCheckoutSession(principal, payload).pipe(
          Effect.mapError(mapCoreError)
        )
      })
    )
    .handle('createPortalSession', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )
        const billingService = yield* BillingService
        return yield* billingService.createPortalSession(principal, payload).pipe(
          Effect.mapError(mapCoreError)
        )
      })
    )
    .handle('getUsageSummary', ({ path, urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )
        const billingService = yield* BillingService
        const now = new Date()
        const defaultStart = new Date(now.getTime() - (1000 * 60 * 60 * 24 * 30))
        const periodStart = parseDateValue(urlParams.periodStart, defaultStart, 'periodStart')
        const periodEnd = parseDateValue(urlParams.periodEnd, now, 'periodEnd')

        if (periodEnd.getTime() < periodStart.getTime()) {
          return yield* Effect.fail(new BadRequest({ message: 'periodEnd must be >= periodStart' }))
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
    .handle('stripeWebhook', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const signature = request.headers['stripe-signature']
        if (!signature) {
          return yield* Effect.fail(new BadRequest({ message: 'Missing stripe-signature header' }))
        }

        const billingService = yield* BillingService
        const rawBody = yield* request.text.pipe(
          Effect.mapError(() => new BadRequest({ message: 'Failed to read webhook request body' }))
        )
        return yield* billingService.processWebhookEvent(rawBody, signature).pipe(
          Effect.mapError(mapCoreError)
        )
      })
    )
)
