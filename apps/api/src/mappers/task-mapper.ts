import type { Task } from '@tx-agent-kit/core'

export const toApiTask = (task: Task) => ({
  id: task.id,
  workspaceId: task.workspaceId,
  title: task.title,
  description: task.description,
  status: task.status,
  createdByUserId: task.createdByUserId,
  createdAt: task.createdAt.toISOString()
})
