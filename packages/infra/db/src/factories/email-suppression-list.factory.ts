import type {
  EmailSuppressionReason,
  EmailSourceSystem
} from '@tx-agent-kit/contracts'
import type { emailSuppressionList } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type EmailSuppressionListInsert = typeof emailSuppressionList.$inferInsert

export interface CreateEmailSuppressionListFactoryOptions {
  email: string
  id?: string
  reason?: EmailSuppressionReason
  sourceSystem?: EmailSourceSystem
  sourceId?: string | null
  suppressedAt?: Date
  liftedAt?: Date | null
  createdAt?: Date
}

export const createEmailSuppressionListFactory = (
  options: CreateEmailSuppressionListFactoryOptions
): EmailSuppressionListInsert => {
  return {
    id: options.id ?? generateId(),
    email: options.email,
    reason: options.reason ?? 'hard_bounce',
    sourceSystem: options.sourceSystem ?? 'campaigns',
    sourceId: options.sourceId ?? null,
    suppressedAt: options.suppressedAt ?? generateTimestamp(),
    liftedAt: options.liftedAt ?? null,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
