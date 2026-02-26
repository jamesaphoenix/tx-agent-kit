import type { creditLedger } from '../schema.js'
import type { CreditEntryType } from '@tx-agent-kit/contracts'
import type { JsonObject } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type CreditLedgerInsert = typeof creditLedger.$inferInsert

export interface CreateCreditLedgerFactoryOptions {
  organizationId: string
  id?: string
  amount?: number
  entryType?: CreditEntryType
  reason?: string
  referenceId?: string | null
  balanceAfter?: number
  metadata?: JsonObject
  createdAt?: Date
}

export const createCreditLedgerFactory = (
  options: CreateCreditLedgerFactoryOptions
): CreditLedgerInsert => {
  return {
    id: options.id ?? generateId(),
    organizationId: options.organizationId,
    amount: options.amount ?? 100,
    entryType: options.entryType ?? 'adjustment',
    reason: options.reason ?? generateUniqueValue('credit-adjustment'),
    referenceId: options.referenceId ?? null,
    balanceAfter: options.balanceAfter ?? 100,
    metadata: options.metadata ?? {},
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
