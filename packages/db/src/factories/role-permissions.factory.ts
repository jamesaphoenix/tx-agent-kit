import type { rolePermissions } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type RolePermissionInsert = typeof rolePermissions.$inferInsert

export interface CreateRolePermissionFactoryOptions {
  roleId: string
  permissionId: string
  id?: string
  createdAt?: Date
}

export const createRolePermissionFactory = (
  options: CreateRolePermissionFactoryOptions
): RolePermissionInsert => {
  return {
    id: options.id ?? generateId(),
    roleId: options.roleId,
    permissionId: options.permissionId,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
