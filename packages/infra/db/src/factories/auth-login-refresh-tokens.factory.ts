import type { authLoginRefreshTokens } from '../schema.js'
import {
  generateFutureTimestamp,
  generateId,
  generateTimestamp,
  generateUniqueValue
} from './factory-helpers.js'

type AuthLoginRefreshTokenInsert = typeof authLoginRefreshTokens.$inferInsert

export interface CreateAuthLoginRefreshTokenFactoryOptions {
  id?: string
  sessionId: string
  tokenHash?: string
  expiresAt?: Date
  usedAt?: Date | null
  revokedAt?: Date | null
  createdAt?: Date
}

export const createAuthLoginRefreshTokenFactory = (
  options: CreateAuthLoginRefreshTokenFactoryOptions
): AuthLoginRefreshTokenInsert => {
  return {
    id: options.id ?? generateId(),
    sessionId: options.sessionId,
    tokenHash: options.tokenHash ?? generateUniqueValue('auth-login-refresh-token-hash'),
    expiresAt: options.expiresAt ?? generateFutureTimestamp(30 * 24 * 60 * 60 * 1000),
    usedAt: options.usedAt ?? null,
    revokedAt: options.revokedAt ?? null,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
