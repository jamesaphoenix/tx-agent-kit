import { Context, Effect, Layer, Option } from 'effect'
import { badRequest, internalError, notFound, unauthorized, type CoreError } from '../../../errors.js'
import {
  ContentReviewTokenStorePort,
  type ContentReviewTokenRecord
} from '../ports/team-ports.js'

const toCoreInternal = (message: string) => (cause: unknown): CoreError =>
  internalError(message, cause)

const DEFAULT_EXPIRY_DAYS = 7

export class ContentReviewTokenService extends Context.Tag('ContentReviewTokenService')<
  ContentReviewTokenService,
  {
    createToken: (input: {
      teamId: string
      permissions: string[]
      reviewerName?: string | null
      reviewerEmail?: string | null
      createdBy: string
      expiresInDays?: number
    }) => Effect.Effect<ContentReviewTokenRecord, CoreError, ContentReviewTokenStorePort>
    validateToken: (
      token: string
    ) => Effect.Effect<ContentReviewTokenRecord, CoreError, ContentReviewTokenStorePort>
    revokeToken: (
      id: string
    ) => Effect.Effect<ContentReviewTokenRecord, CoreError, ContentReviewTokenStorePort>
  }
>() {}

export const ContentReviewTokenServiceLive = Layer.effect(
  ContentReviewTokenService,
  Effect.succeed({
    createToken: (input) =>
      Effect.gen(function* () {
        const tokenStore = yield* ContentReviewTokenStorePort

        const expiryDays = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS
        const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)

        const created = yield* tokenStore.create({
          teamId: input.teamId,
          expiresAt,
          permissions: input.permissions,
          reviewerName: input.reviewerName,
          reviewerEmail: input.reviewerEmail,
          createdBy: input.createdBy
        }).pipe(
          Effect.mapError(toCoreInternal('Failed to create content review token')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Content review token creation failed')),
            onSome: Effect.succeed
          }))
        )

        return created
      }),

    validateToken: (token) =>
      Effect.gen(function* () {
        const tokenStore = yield* ContentReviewTokenStorePort

        if (!token || token.trim().length === 0) {
          return yield* Effect.fail(badRequest('Missing review token'))
        }

        const record = yield* tokenStore.findByToken(token).pipe(
          Effect.mapError(toCoreInternal('Failed to validate content review token')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Content review token not found')),
            onSome: Effect.succeed
          }))
        )

        if (record.revokedAt !== null) {
          return yield* Effect.fail(unauthorized('Content review token has been revoked'))
        }

        if (record.expiresAt.getTime() <= Date.now()) {
          return yield* Effect.fail(unauthorized('Content review token has expired'))
        }

        yield* tokenStore.touchLastAccessed(record.id).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        return record
      }),

    revokeToken: (id) =>
      Effect.gen(function* () {
        const tokenStore = yield* ContentReviewTokenStorePort

        const revoked = yield* tokenStore.revoke(id).pipe(
          Effect.mapError(toCoreInternal('Failed to revoke content review token')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Content review token not found')),
            onSome: Effect.succeed
          }))
        )

        return revoked
      })
  })
)
