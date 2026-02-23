import { tasksRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Layer } from 'effect'
import type { ListParams } from '../../../pagination.js'
import { TaskStorePort, TaskWorkspaceMembershipPort } from '../ports/task-ports.js'

export const TaskStorePortLive = Layer.succeed(TaskStorePort, {
  list: (workspaceId: string, params: ListParams) => tasksRepository.list(workspaceId, params),
  listByWorkspace: (workspaceId: string, params: ListParams) => tasksRepository.listByWorkspace(workspaceId, params),
  getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) =>
    tasksRepository.getManyByIdsForUser(userId, ids),
  getById: (id: string) => tasksRepository.getById(id),
  create: (input: {
    workspaceId: string
    title: string
    description?: string
    createdByUserId: string
  }) => tasksRepository.create(input),
  update: (input: {
    id: string
    title?: string
    description?: string | null
    status?: 'todo' | 'in_progress' | 'done'
  }) => tasksRepository.update(input),
  remove: (id: string) => tasksRepository.remove(id)
})

export const TaskWorkspaceMembershipPortLive = Layer.succeed(TaskWorkspaceMembershipPort, {
  isMember: (workspaceId: string, userId: string) => workspacesRepository.isMember(workspaceId, userId)
})
