import * as Schema from 'effect/Schema'

export const userRowSchema = Schema.Struct({
  id: Schema.UUID,
  email: Schema.String,
  passwordHash: Schema.String,
  name: Schema.String,
  createdAt: Schema.DateFromSelf
})

export type UserRowShape = Schema.Schema.Type<typeof userRowSchema>
