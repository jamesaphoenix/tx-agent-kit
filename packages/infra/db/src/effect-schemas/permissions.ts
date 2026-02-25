import * as Schema from 'effect/Schema'

export const permissionRowSchema = Schema.Struct({
  id: Schema.UUID,
  key: Schema.String,
  createdAt: Schema.DateFromSelf
})

export type PermissionRowShape = Schema.Schema.Type<typeof permissionRowSchema>
