import * as Schema from 'effect/Schema'

export const userUiPreferenceRowSchema = Schema.Struct({
  id: Schema.UUID,
  userId: Schema.UUID,
  organizationId: Schema.UUID,
  preferenceKey: Schema.String,
  dismissedAt: Schema.DateFromSelf,
  createdAt: Schema.DateFromSelf
})

export type UserUiPreferenceRowShape = Schema.Schema.Type<typeof userUiPreferenceRowSchema>
