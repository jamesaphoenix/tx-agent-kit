import type { Task } from '@tx-agent-kit/contracts'

export interface TaskRecord {
  id: string
  workspaceId: string
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'done'
  createdByUserId: string
  createdAt: Date
}

export const toTask = (row: TaskRecord): Task => ({
  id: row.id,
  workspaceId: row.workspaceId,
  title: row.title,
  description: row.description,
  status: row.status,
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt.toISOString()
})
