import * as Schema from 'effect/Schema'
import { listParamsSchema, paginatedResponseSchema } from './common.js'

export const roleSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  isSystem: Schema.Boolean,
  permissions: Schema.Array(Schema.String),
  createdAt: Schema.String
})

export const createRoleRequestSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64)),
  permissions: Schema.Array(Schema.String)
})

export const updateRoleRequestSchema = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64))),
  permissions: Schema.optional(Schema.Array(Schema.String))
})

export const roleApiResponseSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  isSystem: Schema.Boolean,
  permissions: Schema.Array(Schema.String),
  createdAt: Schema.String
})

export const listRolesResponseSchema = paginatedResponseSchema(roleApiResponseSchema)

export const rolesListParamsSchema = Schema.Struct({
  ...listParamsSchema.fields
})

export type Role = Schema.Schema.Type<typeof roleSchema>
export type CreateRoleRequest = Schema.Schema.Type<typeof createRoleRequestSchema>
export type UpdateRoleRequest = Schema.Schema.Type<typeof updateRoleRequestSchema>
