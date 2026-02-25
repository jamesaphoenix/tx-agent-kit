import * as Schema from 'effect/Schema'

export const rolePermissionRowSchema = Schema.Struct({
  id: Schema.UUID,
  roleId: Schema.UUID,
  permissionId: Schema.UUID,
  createdAt: Schema.DateFromSelf
})

export type RolePermissionRowShape = Schema.Schema.Type<typeof rolePermissionRowSchema>
