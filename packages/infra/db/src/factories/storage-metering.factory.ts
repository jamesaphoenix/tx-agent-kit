import type { storageMetering } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type StorageMeteringInsert = typeof storageMetering.$inferInsert

export interface CreateStorageMeteringFactoryOptions {
  organizationId: string
  id?: string
  activeBytes?: number
  softDeletedBytes?: number
  activeAssetCount?: number
  softDeletedAssetCount?: number
  highWaterMarkBytes?: number
  measuredAt?: Date
}

export const createStorageMeteringFactory = (
  options: CreateStorageMeteringFactoryOptions
): StorageMeteringInsert => {
  return {
    id: options.id ?? generateId(),
    organizationId: options.organizationId,
    activeBytes: options.activeBytes ?? 0,
    softDeletedBytes: options.softDeletedBytes ?? 0,
    activeAssetCount: options.activeAssetCount ?? 0,
    softDeletedAssetCount: options.softDeletedAssetCount ?? 0,
    highWaterMarkBytes: options.highWaterMarkBytes ?? Math.max(options.activeBytes ?? 0, 0),
    measuredAt: options.measuredAt ?? generateTimestamp()
  }
}
