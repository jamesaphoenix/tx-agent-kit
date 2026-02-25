import * as Schema from 'effect/Schema'

export const roleRowSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  createdAt: Schema.DateFromSelf
})

export type RoleRowShape = Schema.Schema.Type<typeof roleRowSchema>
