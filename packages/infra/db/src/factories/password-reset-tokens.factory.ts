import type { passwordResetTokens } from '../schema.js'
import {
  generateFutureTimestamp,
  generateId,
  generateTimestamp,
  generateUniqueValue
} from './factory-helpers.js'

type PasswordResetTokenInsert = typeof passwordResetTokens.$inferInsert

export interface CreatePasswordResetTokenFactoryOptions {
  id?: string
  userId: string
  tokenHash?: string
  expiresAt?: Date
  usedAt?: Date | null
  createdAt?: Date
}

export const createPasswordResetTokenFactory = (
  options: CreatePasswordResetTokenFactoryOptions
): PasswordResetTokenInsert => {
  return {
    id: options.id ?? generateId(),
    userId: options.userId,
    tokenHash: options.tokenHash ?? generateUniqueValue('reset-token-hash'),
    expiresAt: options.expiresAt ?? generateFutureTimestamp(30 * 60 * 1000),
    usedAt: options.usedAt ?? null,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
