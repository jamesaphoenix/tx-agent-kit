import type { collectionAssets } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type CollectionAssetInsert = typeof collectionAssets.$inferInsert

export interface CreateCollectionAssetFactoryOptions {
  collectionId: string
  assetId: string
  id?: string
  createdAt?: Date
}

export const createCollectionAssetFactory = (
  options: CreateCollectionAssetFactoryOptions
): CollectionAssetInsert => {
  return {
    id: options.id ?? generateId(),
    collectionId: options.collectionId,
    assetId: options.assetId,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
