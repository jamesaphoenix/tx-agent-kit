import * as Schema from 'effect/Schema'
import { jsonObjectSchema } from '../json-schema.js'

export const systemSettingRowSchema = Schema.Struct({
  key: Schema.String,
  value: jsonObjectSchema,
  description: Schema.NullOr(Schema.String),
  updatedAt: Schema.DateFromSelf
})

export type SystemSettingRowShape = Schema.Schema.Type<typeof systemSettingRowSchema>
