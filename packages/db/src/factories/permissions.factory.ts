import type { permissions } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type PermissionInsert = typeof permissions.$inferInsert

export interface CreatePermissionFactoryOptions {
  id?: string
  key?: string
  createdAt?: Date
}

export const createPermissionFactory = (
  options: CreatePermissionFactoryOptions = {}
): PermissionInsert => {
  return {
    id: options.id ?? generateId(),
    key: options.key ?? generateUniqueValue('permission'),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
