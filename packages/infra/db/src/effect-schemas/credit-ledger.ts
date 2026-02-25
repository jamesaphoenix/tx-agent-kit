import * as Schema from 'effect/Schema'

export const creditLedgerRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  amount: Schema.String,
  reason: Schema.String,
  createdAt: Schema.DateFromSelf
})

export type CreditLedgerRowShape = Schema.Schema.Type<typeof creditLedgerRowSchema>
