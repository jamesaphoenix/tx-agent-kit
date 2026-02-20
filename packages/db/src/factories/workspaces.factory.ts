import type { workspaces } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type WorkspaceInsert = typeof workspaces.$inferInsert

export interface CreateWorkspaceFactoryOptions {
  ownerUserId: string
  id?: string
  name?: string
  organizationId?: string | null
  createdAt?: Date
}

export const createWorkspaceFactory = (
  options: CreateWorkspaceFactoryOptions
): WorkspaceInsert => {
  return {
    id: options.id ?? generateId(),
    name: options.name ?? generateUniqueValue('Workspace'),
    ownerUserId: options.ownerUserId,
    organizationId: options.organizationId ?? null,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
