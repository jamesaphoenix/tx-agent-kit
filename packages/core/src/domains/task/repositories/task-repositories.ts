import { tasksRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Layer } from 'effect'
import { TaskStorePort, TaskWorkspaceMembershipPort } from '../ports/task-ports.js'

export const TaskStorePortLive = Layer.succeed(TaskStorePort, {
  listByWorkspace: (workspaceId: string) => tasksRepository.listByWorkspace(workspaceId),
  create: (input: {
    workspaceId: string
    title: string
    description?: string
    createdByUserId: string
  }) => tasksRepository.create(input)
})

export const TaskWorkspaceMembershipPortLive = Layer.succeed(TaskWorkspaceMembershipPort, {
  isMember: (workspaceId: string, userId: string) => workspacesRepository.isMember(workspaceId, userId)
})
