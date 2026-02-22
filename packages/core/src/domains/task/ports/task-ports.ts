import { Context } from 'effect'
import type * as Effect from 'effect/Effect'

export const TaskRepositoryKind = 'custom' as const

export interface TaskRecord {
  id: string
  workspaceId: string
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'done'
  createdByUserId: string
  createdAt: Date
}

export class TaskStorePort extends Context.Tag('TaskStorePort')<
  TaskStorePort,
  {
    listByWorkspace: (workspaceId: string) => Effect.Effect<ReadonlyArray<TaskRecord>, unknown>
    create: (input: {
      workspaceId: string
      title: string
      description?: string
      createdByUserId: string
    }) => Effect.Effect<TaskRecord | null, unknown>
  }
>() {}

export class TaskWorkspaceMembershipPort extends Context.Tag('TaskWorkspaceMembershipPort')<
  TaskWorkspaceMembershipPort,
  {
    isMember: (workspaceId: string, userId: string) => Effect.Effect<boolean, unknown>
  }
>() {}
