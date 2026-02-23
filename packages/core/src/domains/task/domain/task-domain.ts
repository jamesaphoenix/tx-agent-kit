import {
  taskStatuses,
  type TaskStatus
} from '@tx-agent-kit/contracts'

export type { TaskStatus } from '@tx-agent-kit/contracts'

export interface TaskRecord {
  id: string
  workspaceId: string
  title: string
  description: string | null
  status: TaskStatus
  createdByUserId: string
  createdAt: Date
}

export interface Task {
  id: string
  workspaceId: string
  title: string
  description: string | null
  status: TaskStatus
  createdByUserId: string
  createdAt: Date
}

export interface CreateTaskCommand {
  workspaceId: string
  title: string
  description?: string
}

export interface UpdateTaskCommand {
  title?: string
  description?: string | null
  status?: TaskStatus
}

const maxTaskTitleLength = 200
const maxTaskDescriptionLength = 2000

export const isValidTaskTitle = (title: string): boolean => {
  const trimmed = title.trim()
  return trimmed.length >= 1 && trimmed.length <= maxTaskTitleLength
}

export const isValidTaskDescription = (description: string | undefined): boolean =>
  description == null || description.length <= maxTaskDescriptionLength

const isTaskStatus = (status: string): status is TaskStatus =>
  taskStatuses.some((value) => value === status)

export const isValidTaskStatus = (status: string | undefined): status is TaskStatus | undefined =>
  status === undefined || isTaskStatus(status)

export const normalizeTaskDescription = (description: string | undefined): string | undefined => {
  if (description == null) {
    return undefined
  }

  const trimmed = description.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

export const normalizeNullableTaskDescription = (description: string | null | undefined): string | null | undefined => {
  if (description === null) {
    return null
  }

  if (description === undefined) {
    return undefined
  }

  const trimmed = description.trim()
  return trimmed.length === 0 ? null : trimmed
}

export const toTask = (row: TaskRecord): Task => ({
  id: row.id,
  workspaceId: row.workspaceId,
  title: row.title,
  description: row.description,
  status: row.status,
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt
})
