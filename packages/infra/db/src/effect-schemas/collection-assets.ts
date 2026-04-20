import * as Schema from 'effect/Schema'

export const collectionAssetRowSchema = Schema.Struct({
  id: Schema.UUID,
  collectionId: Schema.UUID,
  assetId: Schema.UUID,
  createdAt: Schema.DateFromSelf
})

export type CollectionAssetRowShape = Schema.Schema.Type<typeof collectionAssetRowSchema>
