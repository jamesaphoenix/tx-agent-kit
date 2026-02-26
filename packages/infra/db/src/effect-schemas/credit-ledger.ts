import * as Schema from 'effect/Schema'
import { creditEntryTypes } from '@tx-agent-kit/contracts'
import { jsonObjectSchema } from '../json-schema.js'

export const creditEntryTypeSchema = Schema.Literal(...creditEntryTypes)

export const creditLedgerRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  amount: Schema.Number,
  entryType: creditEntryTypeSchema,
  reason: Schema.String,
  referenceId: Schema.NullOr(Schema.String),
  balanceAfter: Schema.Number,
  metadata: jsonObjectSchema,
  createdAt: Schema.DateFromSelf
})

export type CreditLedgerRowShape = Schema.Schema.Type<typeof creditLedgerRowSchema>
