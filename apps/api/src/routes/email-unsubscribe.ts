import { HttpApiBuilder } from '@effect/platform'
import {
  EmailCampaignService,
  UnsubscribeStorePort,
  EnrollmentStorePort
} from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { getApiEnv } from '../config/env.js'
import { verifyUnsubscribeToken } from '../utils/unsubscribe-token.js'

const logger = createLogger('email-unsubscribe')

export const EmailUnsubscribeRouteKind = 'custom' as const

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

          const unsubscribeStore = yield* UnsubscribeStorePort

          yield* unsubscribeStore
            .unsubscribe({
              userId: decoded.userId,
              campaignId: decoded.campaignId ?? null
            })
            .pipe(Effect.mapError(mapCoreError))

          // Cancel active enrollments for this user
          if (decoded.campaignId) {
            const enrollmentStore = yield* EnrollmentStorePort
            const service = yield* EmailCampaignService

            const enrollment = yield* enrollmentStore
              .findByCampaignAndUser(decoded.campaignId, decoded.userId)
              .pipe(Effect.mapError(mapCoreError))

            if (enrollment?.status === 'active') {
              yield* service
                .cancelEnrollment(enrollment.id, 'user_unsubscribed')
                .pipe(
                  Effect.catchAll((err) => {
                    logger.error('Failed to cancel enrollment on unsubscribe', {
                      enrollmentId: enrollment.id,
                      error: String(err)
                    })
                    return Effect.succeed(undefined)
                  })
                )
            }
          }

          return {
            unsubscribed: true,
            userId: decoded.userId,
            campaignId: decoded.campaignId ?? null
          }
        })
      )
)
