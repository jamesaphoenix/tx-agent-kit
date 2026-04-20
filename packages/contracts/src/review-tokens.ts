import * as Schema from 'effect/Schema'
import { listParamsSchema, paginatedResponseSchema } from './common.js'
import { reviewTokenPermissions } from './literals.js'

export const reviewTokenPermissionSchema = Schema.Literal(...reviewTokenPermissions)

export const reviewTokenSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  token: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
  permissions: Schema.Array(reviewTokenPermissionSchema),
  reviewerName: Schema.NullOr(Schema.String),
  reviewerEmail: Schema.NullOr(Schema.String),
  lastAccessedAt: Schema.NullOr(Schema.String),
  createdBy: Schema.UUID,
  createdAt: Schema.String
})

export const createReviewTokenRequestSchema = Schema.Struct({
  permissions: Schema.Array(reviewTokenPermissionSchema),
  reviewerName: Schema.optional(Schema.NullOr(Schema.String)),
  reviewerEmail: Schema.optional(Schema.NullOr(Schema.String)),
  expiresInDays: Schema.optional(Schema.Number)
})

export const reviewTokenValidationSchema = Schema.Struct({
  valid: Schema.Boolean,
  token: Schema.optional(reviewTokenSchema),
  teamId: Schema.optional(Schema.UUID),
  permissions: Schema.optional(Schema.Array(Schema.String))
})

export const reviewTokensListParamsSchema = Schema.Struct({
  ...listParamsSchema.fields
})

export const listReviewTokensResponseSchema = paginatedResponseSchema(reviewTokenSchema)

export type ReviewToken = Schema.Schema.Type<typeof reviewTokenSchema>
export type CreateReviewTokenRequest = Schema.Schema.Type<typeof createReviewTokenRequestSchema>
export type ReviewTokenValidation = Schema.Schema.Type<typeof reviewTokenValidationSchema>
