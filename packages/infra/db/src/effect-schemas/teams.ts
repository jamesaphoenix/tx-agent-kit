import * as Schema from 'effect/Schema'

const hexColorSchema = Schema.String.pipe(Schema.pattern(/^#[0-9a-fA-F]{6}$/))

export const brandSettingsColorsSchema = Schema.Struct({
  primary: hexColorSchema,
  secondary: hexColorSchema,
  accent: hexColorSchema,
  background: hexColorSchema,
  text: hexColorSchema
})

export const brandSettingsSchema = Schema.Struct({
  colors: brandSettingsColorsSchema,
  brandGuidelines: Schema.String.pipe(Schema.maxLength(500)),
  industry: Schema.String.pipe(Schema.maxLength(100)),
  targetAudience: Schema.String.pipe(Schema.maxLength(500))
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
