import * as Schema from 'effect/Schema'

export const organizationRowSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  createdAt: Schema.DateFromSelf
})

export type OrganizationRowShape = Schema.Schema.Type<typeof organizationRowSchema>
