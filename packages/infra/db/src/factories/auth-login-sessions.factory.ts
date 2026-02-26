import type { AuthLoginProvider } from '@tx-agent-kit/contracts'
import type { authLoginSessions } from '../schema.js'
import {
  generateFutureTimestamp,
  generateId,
  generateTimestamp
} from './factory-helpers.js'

type AuthLoginSessionInsert = typeof authLoginSessions.$inferInsert

export interface CreateAuthLoginSessionFactoryOptions {
  id?: string
  userId: string
  provider?: AuthLoginProvider
  createdIp?: string | null
  createdUserAgent?: string | null
  lastSeenAt?: Date
  expiresAt?: Date
  revokedAt?: Date | null
  createdAt?: Date
}

export const createAuthLoginSessionFactory = (
  options: CreateAuthLoginSessionFactoryOptions
): AuthLoginSessionInsert => {
  return {
    id: options.id ?? generateId(),
    userId: options.userId,
    provider: options.provider ?? 'password',
    createdIp: options.createdIp ?? null,
    createdUserAgent: options.createdUserAgent ?? null,
    lastSeenAt: options.lastSeenAt ?? generateTimestamp(),
    expiresAt: options.expiresAt ?? generateFutureTimestamp(30 * 24 * 60 * 60 * 1000),
    revokedAt: options.revokedAt ?? null,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
