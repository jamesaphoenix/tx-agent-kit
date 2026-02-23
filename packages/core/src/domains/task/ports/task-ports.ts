import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type { TaskRecord } from '../domain/task-domain.js'

export const TaskRepositoryKind = 'crud' as const

export type { TaskRecord }

export class TaskStorePort extends Context.Tag('TaskStorePort')<
  TaskStorePort,
  {
    list: (workspaceId: string, params: ListParams) => Effect.Effect<PaginatedResult<TaskRecord>, unknown>
    listByWorkspace: (workspaceId: string, params: ListParams) => Effect.Effect<PaginatedResult<TaskRecord>, unknown>
    getManyByIdsForUser: (
      userId: string,
      ids: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<TaskRecord>, unknown>
    getById: (id: string) => Effect.Effect<TaskRecord | null, unknown>
    create: (input: {
      workspaceId: string
      title: string
      description?: string
      createdByUserId: string
    }) => Effect.Effect<TaskRecord | null, unknown>
    update: (input: {
      id: string
      title?: string
      description?: string | null
      status?: 'todo' | 'in_progress' | 'done'
    }) => Effect.Effect<TaskRecord | null, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
  }
>() {}

export class TaskWorkspaceMembershipPort extends Context.Tag('TaskWorkspaceMembershipPort')<
  TaskWorkspaceMembershipPort,
  {
    isMember: (workspaceId: string, userId: string) => Effect.Effect<boolean, unknown>
  }
>() {}
