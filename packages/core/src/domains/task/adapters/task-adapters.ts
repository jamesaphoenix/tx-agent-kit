import { tasksRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import {
  mapNullable,
  toTaskRecord,
  toTaskRecordPage
} from '../../../adapters/db-row-mappers.js'
import type { ListParams } from '../../../pagination.js'
import { TaskStorePort, TaskWorkspaceMembershipPort } from '../ports/task-ports.js'
import type { TaskStatus } from '../domain/task-domain.js'

export const TaskStorePortLive = Layer.succeed(TaskStorePort, {
  list: (workspaceId: string, params: ListParams) =>
    tasksRepository.list(workspaceId, params).pipe(Effect.map(toTaskRecordPage)),
  listByWorkspace: (workspaceId: string, params: ListParams) =>
    tasksRepository.listByWorkspace(workspaceId, params).pipe(Effect.map(toTaskRecordPage)),
  getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) =>
    tasksRepository.getManyByIdsForUser(userId, ids).pipe(Effect.map((rows) => rows.map(toTaskRecord))),
  getById: (id: string) => tasksRepository.getById(id).pipe(Effect.map((row) => mapNullable(row, toTaskRecord))),
  create: (input: {
    workspaceId: string
    title: string
    description?: string
    createdByUserId: string
  }) => tasksRepository.create(input).pipe(Effect.map((row) => mapNullable(row, toTaskRecord))),
  update: (input: {
    id: string
    title?: string
    description?: string | null
    status?: TaskStatus
  }) => tasksRepository.update(input).pipe(Effect.map((row) => mapNullable(row, toTaskRecord))),
  remove: (id: string) => tasksRepository.remove(id)
})

export const TaskWorkspaceMembershipPortLive = Layer.succeed(TaskWorkspaceMembershipPort, {
  isMember: (workspaceId: string, userId: string) => workspacesRepository.isMember(workspaceId, userId)
})
