import * as Schema from 'effect/Schema'
import { listParamsSchema, paginatedResponseSchema } from './common.js'
import { memberRoles } from './literals.js'

const hexColorSchema = Schema.String.pipe(Schema.pattern(/^#[0-9a-fA-F]{6}$/))

export const brandSettingsColorsSchema = Schema.Struct({
  primary: hexColorSchema,
  secondary: hexColorSchema,
  accent: hexColorSchema,
  background: hexColorSchema,
  text: hexColorSchema
})

export const brandSettingsApiSchema = Schema.Struct({
  colors: brandSettingsColorsSchema,
  brandGuidelines: Schema.String.pipe(Schema.maxLength(500)),
  industry: Schema.String.pipe(Schema.maxLength(100)),
  targetAudience: Schema.String.pipe(Schema.maxLength(500))
})

export const teamSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  name: Schema.String,
  website: Schema.NullOr(Schema.String),
  brandSettings: Schema.NullOr(brandSettingsApiSchema),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const createTeamRequestSchema = Schema.Struct({
  organizationId: Schema.UUID,
  name: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64)),
  website: Schema.optional(Schema.NullOr(Schema.String)),
  brandSettings: brandSettingsApiSchema
})

export const updateTeamRequestSchema = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64))),
  website: Schema.optional(Schema.NullOr(Schema.String)),
  brandSettings: Schema.optional(Schema.NullOr(brandSettingsApiSchema))
})

export const teamApiResponseSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  name: Schema.String,
  website: Schema.NullOr(Schema.String),
  brandSettings: Schema.NullOr(brandSettingsApiSchema),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const listTeamsResponseSchema = paginatedResponseSchema(teamApiResponseSchema)

export const teamsListParamsSchema = Schema.Struct({
  organizationId: Schema.UUID,
  ...listParamsSchema.fields
})

export const teamMemberSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  userId: Schema.UUID,
  roleId: Schema.NullOr(Schema.UUID),
  role: Schema.Literal(...memberRoles),
  disabledAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const teamMembersResponseSchema = paginatedResponseSchema(teamMemberSchema)

export const addTeamMemberRequestSchema = Schema.Struct({
  userId: Schema.UUID
})

export const updateTeamMemberRoleRequestSchema = Schema.Struct({
  roleId: Schema.NullOr(Schema.UUID)
})

export const teamMembersListParamsSchema = Schema.Struct({
  ...listParamsSchema.fields
})

export type BrandSettingsColors = Schema.Schema.Type<typeof brandSettingsColorsSchema>
export type BrandSettings = Schema.Schema.Type<typeof brandSettingsApiSchema>
export type Team = Schema.Schema.Type<typeof teamSchema>
export type CreateTeamRequest = Schema.Schema.Type<typeof createTeamRequestSchema>
export type UpdateTeamRequest = Schema.Schema.Type<typeof updateTeamRequestSchema>
export type TeamMember = Schema.Schema.Type<typeof teamMemberSchema>
export type AddTeamMemberRequest = Schema.Schema.Type<typeof addTeamMemberRequestSchema>
export type UpdateTeamMemberRoleRequest = Schema.Schema.Type<typeof updateTeamMemberRoleRequestSchema>
