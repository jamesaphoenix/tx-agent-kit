import * as Schema from 'effect/Schema'

export const brandSettingsSchema = Schema.Struct({
  primaryColor: Schema.optional(Schema.String),
  logoUrl: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String }))
})

export const teamRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  name: Schema.String,
  website: Schema.NullOr(Schema.String),
  brandSettings: Schema.NullOr(brandSettingsSchema),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type TeamRowShape = Schema.Schema.Type<typeof teamRowSchema>
