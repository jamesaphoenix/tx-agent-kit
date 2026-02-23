import type { workspaceMembers } from '../schema.js'
import { workspaceMemberRoles, type WorkspaceMemberRole } from '@tx-agent-kit/contracts'
import { generateId, generateTimestamp } from './factory-helpers.js'

type WorkspaceMemberInsert = typeof workspaceMembers.$inferInsert

export interface CreateWorkspaceMemberFactoryOptions {
  workspaceId: string
  userId: string
  role?: WorkspaceMemberRole
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
    role: options.role ?? workspaceMemberRoles[2],
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
