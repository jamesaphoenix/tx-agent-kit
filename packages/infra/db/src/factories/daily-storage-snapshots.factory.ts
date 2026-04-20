import type { dailyStorageSnapshots } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type DailyStorageSnapshotInsert = typeof dailyStorageSnapshots.$inferInsert

export interface CreateDailyStorageSnapshotFactoryOptions {
  organizationId: string
  snapshotDate: string
  id?: string
  highWaterMarkBytes?: number
  includedBytes?: number
  overageBytes?: number
  overageCostDecimillicents?: number
  ledgerEntryId?: string | null
  createdAt?: Date
}

export const createDailyStorageSnapshotFactory = (
  options: CreateDailyStorageSnapshotFactoryOptions
): DailyStorageSnapshotInsert => {
  return {
    id: options.id ?? generateId(),
    organizationId: options.organizationId,
    snapshotDate: options.snapshotDate,
    highWaterMarkBytes: options.highWaterMarkBytes ?? 0,
    includedBytes: options.includedBytes ?? 50 * 1024 * 1024 * 1024,
    overageBytes: options.overageBytes ?? 0,
    overageCostDecimillicents: options.overageCostDecimillicents ?? 0,
    ledgerEntryId: options.ledgerEntryId ?? null,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
