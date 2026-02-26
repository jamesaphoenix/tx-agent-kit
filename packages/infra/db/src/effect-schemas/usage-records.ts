import * as Schema from 'effect/Schema'
import { usageCategories } from '@tx-agent-kit/contracts'
import { jsonObjectSchema } from '../json-schema.js'

export const usageCategorySchema = Schema.Literal(...usageCategories)

export const usageRecordRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  category: usageCategorySchema,
  quantity: Schema.Number,
  unitCostDecimillicents: Schema.Number,
  totalCostDecimillicents: Schema.Number,
  referenceId: Schema.NullOr(Schema.String),
  stripeUsageRecordId: Schema.NullOr(Schema.String),
  metadata: jsonObjectSchema,
  recordedAt: Schema.DateFromSelf,
  createdAt: Schema.DateFromSelf
})

export type UsageRecordRowShape = Schema.Schema.Type<typeof usageRecordRowSchema>
