import type { autoRechargeAttempts } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type AutoRechargeAttemptInsert = typeof autoRechargeAttempts.$inferInsert

export interface CreateAutoRechargeAttemptFactoryOptions {
  organizationId: string
  amountDecimillicents: number
  id?: string
  status?: string
  stripePaymentIntentId?: string | null
  failureReason?: string | null
  createdAt?: Date
  completedAt?: Date | null
}

export const createAutoRechargeAttemptFactory = (
  options: CreateAutoRechargeAttemptFactoryOptions
): AutoRechargeAttemptInsert => ({
  id: options.id ?? generateId(),
  organizationId: options.organizationId,
  amountDecimillicents: options.amountDecimillicents,
  status: options.status ?? 'pending',
  stripePaymentIntentId: options.stripePaymentIntentId ?? null,
  failureReason: options.failureReason ?? null,
  createdAt: options.createdAt ?? generateTimestamp(),
  completedAt: options.completedAt ?? null
})
