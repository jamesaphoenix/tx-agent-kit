import * as Schema from 'effect/Schema'

export const authLoginRefreshTokenRowSchema = Schema.Struct({
  id: Schema.UUID,
  sessionId: Schema.UUID,
  tokenHash: Schema.String,
  expiresAt: Schema.DateFromSelf,
  usedAt: Schema.NullOr(Schema.DateFromSelf),
  revokedAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf
})

export type AuthLoginRefreshTokenRowShape = Schema.Schema.Type<typeof authLoginRefreshTokenRowSchema>
