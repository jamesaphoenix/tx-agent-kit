import { HttpApiBuilder } from '@effect/platform'
import {
  UnsubscribeStorePort,
  EnrollmentStorePort
} from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { getApiEnv } from '../config/env.js'
import { verifyUnsubscribeToken } from '@tx-agent-kit/email'

const logger = createLogger('tx-agent-kit-api').child('email-unsubscribe')

export const EmailUnsubscribeRouteKind = 'custom' as const

/**
 * One click stops ALL future lifecycle emails. We write a GLOBAL suppression row
 * (campaignId null), which the drip sweep's unsubscribe guard reads for every
 * campaign, so no further email is sent to this user. We also eagerly cancel
 * every active enrollment so none lingers 'active' (the sweep would stop them on
 * its next pass anyway, but eager cancel is the complete, instant version).
 *
 * The token may carry the campaign the user clicked from (context/analytics), but
 * the action is intentionally global: a recipient who clicks "unsubscribe" expects
 * to stop hearing from us, not just from one sequence.
 */
const processGlobalUnsubscribe = (userId: string) =>
  Effect.gen(function* () {
    const unsubscribeStore = yield* UnsubscribeStorePort
    const enrollmentStore = yield* EnrollmentStorePort

    // Hard requirement: the global suppression row is the deliverability/compliance
    // guarantee that future sends stop. Failing it must fail the request.
    yield* unsubscribeStore
      .unsubscribe({ userId, campaignId: null })
      .pipe(Effect.mapError(mapCoreError))

    // Best-effort cleanup: cancel every active enrollment. The suppression row
    // above already stops sends, so a cancel failure must not fail the unsubscribe.
    yield* enrollmentStore
      .cancelAllActiveForUser(userId, 'user_unsubscribed')
      .pipe(
        Effect.catchAll((err) => {
          logger.error('Failed to cancel enrollments on unsubscribe', {
            userId,
            error: String(err)
          })
          return Effect.succeed(0)
        })
      )
  })

export const EmailUnsubscribeLive = HttpApiBuilder.group(
  TxAgentApi,
  'emailUnsubscribe',
  (handlers) =>
    handlers
      .handle('getUnsubscribe', ({ urlParams }) =>
        Effect.gen(function* () {
          const token = urlParams.token

          if (!token) {
            return yield* Effect.fail(
              new BadRequest({ message: 'Missing unsubscribe token' })
            )
          }

          const env = getApiEnv()
          const decoded = verifyUnsubscribeToken(token, env.AUTH_SECRET)

          if (!decoded) {
            return yield* Effect.fail(
              new BadRequest({ message: 'Invalid or expired unsubscribe token' })
            )
          }

          return {
            valid: true,
            userId: decoded.userId,
            campaignId: decoded.campaignId ?? null
          }
        })
      )
      .handle('postUnsubscribe', ({ payload }) =>
        Effect.gen(function* () {
          const env = getApiEnv()
          const decoded = verifyUnsubscribeToken(payload.token, env.AUTH_SECRET)

          if (!decoded) {
            return yield* Effect.fail(
              new BadRequest({ message: 'Invalid or expired unsubscribe token' })
            )
          }

          yield* processGlobalUnsubscribe(decoded.userId)

          // Global: the user is now suppressed from every campaign.
          return {
            unsubscribed: true,
            userId: decoded.userId,
            campaignId: null
          }
        })
      )
      // RFC 8058 one-click unsubscribe target. Mail clients (Gmail/Yahoo) POST
      // `List-Unsubscribe=One-Click` to the List-Unsubscribe URL; the token rides
      // the query string, so there is no JSON body and no interactive confirmation.
      .handle('postUnsubscribeOneClick', ({ urlParams }) =>
        Effect.gen(function* () {
          const token = urlParams.token

          if (!token) {
            return yield* Effect.fail(
              new BadRequest({ message: 'Missing unsubscribe token' })
            )
          }

          const env = getApiEnv()
          const decoded = verifyUnsubscribeToken(token, env.AUTH_SECRET)

          if (!decoded) {
            return yield* Effect.fail(
              new BadRequest({ message: 'Invalid or expired unsubscribe token' })
            )
          }

          yield* processGlobalUnsubscribe(decoded.userId)

          return {
            unsubscribed: true,
            userId: decoded.userId,
            campaignId: null
          }
        })
      )
)
