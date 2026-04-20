import type { AssetType } from '@tx-agent-kit/contracts'
import type { teamMediaAssets } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type TeamMediaAssetInsert = typeof teamMediaAssets.$inferInsert

export interface CreateTeamMediaAssetFactoryOptions {
  teamId: string
  id?: string
  originalFilename?: string
  fileSize?: number
  mimeType?: string
  assetType?: AssetType
  storagePath?: string
  thumbnailPath?: string | null
  contentHash?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export const createTeamMediaAssetFactory = (
  options: CreateTeamMediaAssetFactoryOptions
): TeamMediaAssetInsert => {
  const id = options.id ?? generateId()
  return {
    id,
    teamId: options.teamId,
    originalFilename: options.originalFilename ?? generateUniqueValue('file') + '.jpg',
    fileSize: options.fileSize ?? 1024,
    mimeType: options.mimeType ?? 'image/jpeg',
    assetType: options.assetType ?? 'image',
    storagePath: options.storagePath ?? `${options.teamId}/${id}_test.jpg`,
    thumbnailPath: options.thumbnailPath ?? null,
    contentHash: options.contentHash ?? null,
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
