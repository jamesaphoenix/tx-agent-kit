import * as Schema from 'effect/Schema'

export const dailyStorageSnapshotRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  snapshotDate: Schema.String,
  highWaterMarkBytes: Schema.Number,
  includedBytes: Schema.Number,
  overageBytes: Schema.Number,
  overageCostDecimillicents: Schema.Number,
  ledgerEntryId: Schema.NullOr(Schema.UUID),
  createdAt: Schema.DateFromSelf
})

export type DailyStorageSnapshotRowShape = Schema.Schema.Type<typeof dailyStorageSnapshotRowSchema>
