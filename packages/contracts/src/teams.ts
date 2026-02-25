import * as Schema from 'effect/Schema'
import { paginatedResponseSchema } from './common.js'

export const teamSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  name: Schema.String,
  website: Schema.NullOr(Schema.String),
  brandSettings: Schema.NullOr(Schema.Unknown),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const createTeamRequestSchema = Schema.Struct({
  organizationId: Schema.UUID,
  name: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64))
})

export const updateTeamRequestSchema = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64)))
})

export const listTeamsResponseSchema = paginatedResponseSchema(teamSchema)

export type Team = Schema.Schema.Type<typeof teamSchema>
export type CreateTeamRequest = Schema.Schema.Type<typeof createTeamRequestSchema>
export type UpdateTeamRequest = Schema.Schema.Type<typeof updateTeamRequestSchema>
