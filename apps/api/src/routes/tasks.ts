import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization, TaskService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { parseListQuery } from './list-query.js'

export const TasksRouteKind = 'crud' as const

const toApiTask = (task: {
  id: string
  workspaceId: string
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'done'
  createdByUserId: string
  createdAt: Date
}) => ({
  id: task.id,
  workspaceId: task.workspaceId,
  title: task.title,
  description: task.description,
  status: task.status,
  createdByUserId: task.createdByUserId,
  createdAt: task.createdAt.toISOString()
})

export const TasksLive = HttpApiBuilder.group(TxAgentApi, 'tasks', (handlers) =>
  handlers
    .handle('listTasks', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TaskService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'title', 'status'],
          allowedFilterKeys: ['status', 'createdByUserId']
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service
          .listByWorkspace(principal, urlParams.workspaceId, parsed.value)
          .pipe(Effect.mapError(mapCoreError))

        return {
          data: page.data.map(toApiTask),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('getTask', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TaskService
        const task = yield* service.getById(principal, path.taskId).pipe(Effect.mapError(mapCoreError))
        return toApiTask(task)
      })
    )
    .handle('getManyTasks', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TaskService
        const tasks = yield* service.getManyByIds(principal, payload.ids).pipe(Effect.mapError(mapCoreError))
        return {
          data: tasks.map(toApiTask)
        }
      })
    )
    .handle('createTask', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TaskService
        const task = yield* service.create(principal, payload).pipe(Effect.mapError(mapCoreError))
        return toApiTask(task)
      })
    )
    .handle('updateTask', ({ path, payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TaskService
        const task = yield* service.update(principal, path.taskId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiTask(task)
      })
    )
    .handle('removeTask', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TaskService
        return yield* service.remove(principal, path.taskId).pipe(Effect.mapError(mapCoreError))
      })
    )
)
