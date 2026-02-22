import type { Task } from '@tx-agent-kit/contracts'
import { createTaskRequestSchema } from '@tx-agent-kit/contracts'
import { Context, Effect, Layer } from 'effect'
import * as Schema from 'effect/Schema'
import { badRequest, unauthorized, type CoreError } from '../../../errors.js'
import { toTask } from '../domain/task-domain.js'
import { TaskStorePort, TaskWorkspaceMembershipPort } from '../ports/task-ports.js'

export class TaskService extends Context.Tag('TaskService')<
  TaskService,
  {
    listByWorkspace: (
      principal: { userId: string },
      workspaceId: string
    ) => Effect.Effect<{ tasks: Task[] }, CoreError, TaskStorePort | TaskWorkspaceMembershipPort>
    create: (
      principal: { userId: string },
      input: unknown
    ) => Effect.Effect<Task, CoreError, TaskStorePort | TaskWorkspaceMembershipPort>
  }
>() {}

export const TaskServiceLive = Layer.effect(
  TaskService,
  Effect.succeed({
    listByWorkspace: (principal, workspaceId) =>
      Effect.gen(function* () {
        const workspaceMembershipPort = yield* TaskWorkspaceMembershipPort
        const taskStorePort = yield* TaskStorePort

        const isMember = yield* workspaceMembershipPort.isMember(workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify workspace membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this workspace'))
        }

        const rows = yield* taskStorePort.listByWorkspace(workspaceId).pipe(
          Effect.mapError(() => badRequest('Failed to list tasks'))
        )

        return { tasks: rows.map(toTask) }
      }),

    create: (principal, input: unknown) =>
      Effect.gen(function* () {
        const workspaceMembershipPort = yield* TaskWorkspaceMembershipPort
        const taskStorePort = yield* TaskStorePort

        const parsed = yield* Schema.decodeUnknown(createTaskRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid task payload'))
        )

        const isMember = yield* workspaceMembershipPort.isMember(parsed.workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify workspace membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to create tasks in this workspace'))
        }

        const created = yield* taskStorePort.create({
          workspaceId: parsed.workspaceId,
          title: parsed.title,
          description: parsed.description,
          createdByUserId: principal.userId
        }).pipe(Effect.mapError(() => badRequest('Failed to create task')))

        if (!created) {
          return yield* Effect.fail(badRequest('Task creation failed'))
        }

        return toTask(created)
      })
  })
)
