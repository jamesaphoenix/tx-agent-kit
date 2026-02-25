import * as Schema from 'effect/Schema'

export const passwordResetTokenRowSchema = Schema.Struct({
  id: Schema.UUID,
  userId: Schema.UUID,
  tokenHash: Schema.String,
  expiresAt: Schema.DateFromSelf,
  usedAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf
})

export type PasswordResetTokenRowShape = Schema.Schema.Type<typeof passwordResetTokenRowSchema>
