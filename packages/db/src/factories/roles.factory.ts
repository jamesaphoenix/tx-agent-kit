import type { roles } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type RoleInsert = typeof roles.$inferInsert

export interface CreateRoleFactoryOptions {
  id?: string
  name?: string
  createdAt?: Date
}

export const createRoleFactory = (options: CreateRoleFactoryOptions = {}): RoleInsert => {
  return {
    id: options.id ?? generateId(),
    name: options.name ?? generateUniqueValue('role'),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
