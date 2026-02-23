import type { tasks } from '../schema.js'
import { taskStatuses, type TaskStatus } from '@tx-agent-kit/contracts'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type TaskInsert = typeof tasks.$inferInsert

export interface CreateTaskFactoryOptions {
  workspaceId: string
  createdByUserId: string
  id?: string
  title?: string
  description?: string | null
  status?: TaskStatus
  createdAt?: Date
}

export const createTaskFactory = (options: CreateTaskFactoryOptions): TaskInsert => {
  return {
    id: options.id ?? generateId(),
    workspaceId: options.workspaceId,
    title: options.title ?? generateUniqueValue('Task'),
    description: options.description ?? null,
    status: options.status ?? taskStatuses[0],
    createdByUserId: options.createdByUserId,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
