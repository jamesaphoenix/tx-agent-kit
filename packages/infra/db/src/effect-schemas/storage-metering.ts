import * as Schema from 'effect/Schema'

export const storageMeteringRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  activeBytes: Schema.Number,
  softDeletedBytes: Schema.Number,
  activeAssetCount: Schema.Number,
  softDeletedAssetCount: Schema.Number,
  highWaterMarkBytes: Schema.Number,
  measuredAt: Schema.DateFromSelf
})

export type StorageMeteringRowShape = Schema.Schema.Type<typeof storageMeteringRowSchema>
