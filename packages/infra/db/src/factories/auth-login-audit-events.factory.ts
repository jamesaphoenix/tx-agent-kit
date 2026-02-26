import type { AuthLoginAuditEventType, AuthLoginAuditStatus } from '@tx-agent-kit/contracts'
import type { authLoginAuditEvents, JsonObject } from '../schema.js'
import {
  generateId,
  generateTimestamp
} from './factory-helpers.js'

type AuthLoginAuditEventInsert = typeof authLoginAuditEvents.$inferInsert

export interface CreateAuthLoginAuditEventFactoryOptions {
  id?: string
  userId?: string | null
  eventType?: AuthLoginAuditEventType
  status?: AuthLoginAuditStatus
  identifier?: string | null
  ipAddress?: string | null
  metadata?: JsonObject
  createdAt?: Date
}

export const createAuthLoginAuditEventFactory = (
  options: CreateAuthLoginAuditEventFactoryOptions = {}
): AuthLoginAuditEventInsert => {
  return {
    id: options.id ?? generateId(),
    userId: options.userId ?? null,
    eventType: options.eventType ?? 'login_success',
    status: options.status ?? 'success',
    identifier: options.identifier ?? null,
    ipAddress: options.ipAddress ?? null,
    metadata: options.metadata ?? {},
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
