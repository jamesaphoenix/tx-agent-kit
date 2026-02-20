import type { workspaceMembers } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type WorkspaceMemberInsert = typeof workspaceMembers.$inferInsert

export interface CreateWorkspaceMemberFactoryOptions {
  workspaceId: string
  userId: string
  role?: 'owner' | 'admin' | 'member'
  id?: string
  createdAt?: Date
}

export const createWorkspaceMemberFactory = (
  options: CreateWorkspaceMemberFactoryOptions
): WorkspaceMemberInsert => {
  return {
    id: options.id ?? generateId(),
    workspaceId: options.workspaceId,
    userId: options.userId,
    role: options.role ?? 'member',
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
