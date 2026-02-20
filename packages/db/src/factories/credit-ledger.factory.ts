import type { creditLedger } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type CreditLedgerInsert = typeof creditLedger.$inferInsert

export interface CreateCreditLedgerFactoryOptions {
  workspaceId: string
  id?: string
  amount?: string
  reason?: string
  createdAt?: Date
}

export const createCreditLedgerFactory = (
  options: CreateCreditLedgerFactoryOptions
): CreditLedgerInsert => {
  return {
    id: options.id ?? generateId(),
    workspaceId: options.workspaceId,
    amount: options.amount ?? '100',
    reason: options.reason ?? generateUniqueValue('credit-adjustment'),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
