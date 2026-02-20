import type { Task } from '@tx-agent-kit/contracts'
import { createTaskRequestSchema } from '@tx-agent-kit/contracts'
import { tasksRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Context, Effect, Layer } from 'effect'
import * as Schema from 'effect/Schema'
import { badRequest, unauthorized, type CoreError } from './errors.js'

const toTask = (row: {
  id: string
  workspaceId: string
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'done'
  createdByUserId: string
  createdAt: Date
}): Task => ({
  id: row.id,
  workspaceId: row.workspaceId,
  title: row.title,
  description: row.description,
  status: row.status,
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt.toISOString()
})

export class TaskService extends Context.Tag('TaskService')<
  TaskService,
  {
    listByWorkspace: (principal: { userId: string }, workspaceId: string) => Effect.Effect<{ tasks: Task[] }, CoreError>
    create: (principal: { userId: string }, input: unknown) => Effect.Effect<Task, CoreError>
  }
>() {}

export const TaskServiceLive = Layer.effect(
  TaskService,
  Effect.succeed({
    listByWorkspace: (principal, workspaceId) =>
      Effect.gen(function* () {
        const isMember = yield* Effect.tryPromise({
          try: () => workspacesRepository.isMember(workspaceId, principal.userId),
          catch: () => unauthorized('Failed to verify workspace membership')
        })

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this workspace'))
        }

        const rows = yield* Effect.tryPromise({
          try: () => tasksRepository.listByWorkspace(workspaceId),
          catch: () => badRequest('Failed to list tasks')
        })

        return { tasks: rows.map(toTask) }
      }),

    create: (principal, input: unknown) =>
      Effect.gen(function* () {
        const parsed = yield* Schema.decodeUnknown(createTaskRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid task payload'))
        )

        const isMember = yield* Effect.tryPromise({
          try: () => workspacesRepository.isMember(parsed.workspaceId, principal.userId),
          catch: () => unauthorized('Failed to verify workspace membership')
        })

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to create tasks in this workspace'))
        }

        const created = yield* Effect.tryPromise({
          try: () =>
            tasksRepository.create({
              workspaceId: parsed.workspaceId,
              title: parsed.title,
              description: parsed.description,
              createdByUserId: principal.userId
            }),
          catch: () => badRequest('Failed to create task')
        })

        if (!created) {
          return yield* Effect.fail(badRequest('Task creation failed'))
        }

        return toTask(created)
      })
  })
)
