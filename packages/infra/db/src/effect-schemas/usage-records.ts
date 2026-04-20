import * as Schema from 'effect/Schema'
import { usageCategories } from '@tx-agent-kit/contracts'
import { jsonObjectSchema } from '../json-schema.js'

export const usageCategorySchema = Schema.Literal(...usageCategories)

export const usageRecordRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.NullOr(Schema.UUID),
  category: usageCategorySchema,
  quantity: Schema.Number,
  unitCostDecimillicents: Schema.Number,
  totalCostDecimillicents: Schema.Number,
  marginMultiplier: Schema.NullOr(Schema.Number),
  referenceId: Schema.NullOr(Schema.String),
  assetId: Schema.NullOr(Schema.UUID),
  stripeUsageRecordId: Schema.NullOr(Schema.String),
  metadata: jsonObjectSchema,
  recordedAt: Schema.DateFromSelf,
  createdAt: Schema.DateFromSelf
})

export type UsageRecordRowShape = Schema.Schema.Type<typeof usageRecordRowSchema>
