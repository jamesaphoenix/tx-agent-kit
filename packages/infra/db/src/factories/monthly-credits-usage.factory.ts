import type { monthlyCreditsUsage } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type MonthlyCreditsUsageInsert = typeof monthlyCreditsUsage.$inferInsert

export interface CreateMonthlyCreditsUsageFactoryOptions {
  orgId: string
  id?: string
  periodStart?: Date
  periodEnd?: Date
  creditsUsed?: number
  planTier?: string | null
  createdAt?: Date
}

export const createMonthlyCreditsUsageFactory = (
  options: CreateMonthlyCreditsUsageFactoryOptions
): MonthlyCreditsUsageInsert => ({
  id: options.id ?? generateId(),
  orgId: options.orgId,
  periodStart: options.periodStart ?? new Date('2026-03-01'),
  periodEnd: options.periodEnd ?? new Date('2026-03-31'),
  creditsUsed: options.creditsUsed ?? 0,
  planTier: options.planTier ?? null,
  createdAt: options.createdAt ?? generateTimestamp()
})
