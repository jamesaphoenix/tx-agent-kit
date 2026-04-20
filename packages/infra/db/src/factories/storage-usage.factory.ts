import type { storageUsage } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type StorageUsageInsert = typeof storageUsage.$inferInsert

export interface CreateStorageUsageFactoryOptions {
  orgId: string
  id?: string
  periodStart?: Date
  periodEnd?: Date
  currentBytes?: number
  planStorageLimit?: number
  planTier?: string | null
  createdAt?: Date
}

export const createStorageUsageFactory = (
  options: CreateStorageUsageFactoryOptions
): StorageUsageInsert => ({
  id: options.id ?? generateId(),
  orgId: options.orgId,
  periodStart: options.periodStart ?? new Date('2026-03-01'),
  periodEnd: options.periodEnd ?? new Date('2026-03-31'),
  currentBytes: options.currentBytes ?? 0,
  planStorageLimit: options.planStorageLimit ?? 104_857_600,
  planTier: options.planTier ?? null,
  createdAt: options.createdAt ?? generateTimestamp()
})
