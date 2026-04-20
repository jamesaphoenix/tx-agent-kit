import * as Schema from 'effect/Schema'

export const storageUsageRowSchema = Schema.Struct({
  id: Schema.UUID,
  orgId: Schema.UUID,
  periodStart: Schema.DateFromSelf,
  periodEnd: Schema.DateFromSelf,
  currentBytes: Schema.Number,
  planStorageLimit: Schema.Number,
  planTier: Schema.NullOr(Schema.String),
  createdAt: Schema.DateFromSelf
})

export type StorageUsageRowShape = Schema.Schema.Type<typeof storageUsageRowSchema>
