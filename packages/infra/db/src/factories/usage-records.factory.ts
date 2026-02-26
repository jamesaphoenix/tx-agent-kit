import type { usageRecords } from '../schema.js'
import type { UsageCategory } from '@tx-agent-kit/contracts'
import type { JsonObject } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type UsageRecordInsert = typeof usageRecords.$inferInsert

export interface CreateUsageRecordFactoryOptions {
  organizationId: string
  id?: string
  category?: UsageCategory
  quantity?: number
  unitCostDecimillicents?: number
  totalCostDecimillicents?: number
  referenceId?: string | null
  stripeUsageRecordId?: string | null
  metadata?: JsonObject
  recordedAt?: Date
  createdAt?: Date
}

export const createUsageRecordFactory = (
  options: CreateUsageRecordFactoryOptions
): UsageRecordInsert => {
  const quantity = options.quantity ?? 1
  const unitCostDecimillicents = options.unitCostDecimillicents ?? 100_000

  return {
    id: options.id ?? generateId(),
    organizationId: options.organizationId,
    category: options.category ?? 'api_call',
    quantity,
    unitCostDecimillicents,
    totalCostDecimillicents: options.totalCostDecimillicents ?? quantity * unitCostDecimillicents,
    referenceId: options.referenceId ?? null,
    stripeUsageRecordId: options.stripeUsageRecordId ?? null,
    metadata: options.metadata ?? {},
    recordedAt: options.recordedAt ?? generateTimestamp(),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
