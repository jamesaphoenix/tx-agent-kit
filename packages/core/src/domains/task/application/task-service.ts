import { Context, Effect, Layer } from 'effect'
import { badRequest, notFound, unauthorized, type CoreError } from '../../../errors.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import {
  isValidTaskDescription,
  isValidTaskStatus,
  isValidTaskTitle,
  normalizeNullableTaskDescription,
  normalizeTaskDescription,
  toTask,
  type CreateTaskCommand,
  type Task,
  type UpdateTaskCommand
} from '../domain/task-domain.js'
import { TaskStorePort, TaskWorkspaceMembershipPort } from '../ports/task-ports.js'

export class TaskService extends Context.Tag('TaskService')<
  TaskService,
  {
    listByWorkspace: (
      principal: { userId: string },
      workspaceId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<Task>, CoreError, TaskStorePort | TaskWorkspaceMembershipPort>
    getById: (
      principal: { userId: string },
      id: string
    ) => Effect.Effect<Task, CoreError, TaskStorePort | TaskWorkspaceMembershipPort>
    getManyByIds: (
      principal: { userId: string },
      ids: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<Task>, CoreError, TaskStorePort>
    create: (
      principal: { userId: string },
      input: CreateTaskCommand
    ) => Effect.Effect<Task, CoreError, TaskStorePort | TaskWorkspaceMembershipPort>
    update: (
      principal: { userId: string },
      id: string,
      input: UpdateTaskCommand
    ) => Effect.Effect<Task, CoreError, TaskStorePort | TaskWorkspaceMembershipPort>
    remove: (
      principal: { userId: string },
      id: string
    ) => Effect.Effect<{ deleted: true }, CoreError, TaskStorePort | TaskWorkspaceMembershipPort>
  }
>() {}

export const TaskServiceLive = Layer.effect(
  TaskService,
  Effect.succeed({
    listByWorkspace: (principal, workspaceId, params) =>
      Effect.gen(function* () {
        const workspaceMembershipPort = yield* TaskWorkspaceMembershipPort
        const taskStorePort = yield* TaskStorePort

        const isMember = yield* workspaceMembershipPort.isMember(workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify workspace membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this workspace'))
        }

        const page = yield* taskStorePort.listByWorkspace(workspaceId, params).pipe(
          Effect.mapError(() => badRequest('Failed to list tasks'))
        )

        return {
          data: page.data.map(toTask),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      }),

    getById: (principal, id) =>
      Effect.gen(function* () {
        const workspaceMembershipPort = yield* TaskWorkspaceMembershipPort
        const taskStorePort = yield* TaskStorePort

        const row = yield* taskStorePort.getById(id).pipe(
          Effect.mapError(() => badRequest('Failed to fetch task'))
        )

        if (!row) {
          return yield* Effect.fail(notFound('Task not found'))
        }

        const isMember = yield* workspaceMembershipPort.isMember(row.workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify workspace membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this workspace'))
        }

        return toTask(row)
      }),

    getManyByIds: (principal, ids) =>
      Effect.gen(function* () {
        const taskStorePort = yield* TaskStorePort

        if (ids.length === 0) {
          return [] as const
        }

        const rows = yield* taskStorePort.getManyByIdsForUser(principal.userId, ids).pipe(
          Effect.mapError(() => badRequest('Failed to fetch tasks'))
        )

        const byId = new Map(rows.map((row) => [row.id, row] as const))
        return ids.flatMap((id) => {
          const row = byId.get(id)
          return row ? [toTask(row)] : []
        })
      }),

    create: (principal, input) =>
      Effect.gen(function* () {
        const workspaceMembershipPort = yield* TaskWorkspaceMembershipPort
        const taskStorePort = yield* TaskStorePort

        if (!isValidTaskTitle(input.title) || !isValidTaskDescription(input.description)) {
          return yield* Effect.fail(badRequest('Invalid task payload'))
        }

        const title = input.title.trim()
        const description = normalizeTaskDescription(input.description)

        const isMember = yield* workspaceMembershipPort.isMember(input.workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify workspace membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to create tasks in this workspace'))
        }

        const created = yield* taskStorePort.create({
          workspaceId: input.workspaceId,
          title,
          description,
          createdByUserId: principal.userId
        }).pipe(Effect.mapError(() => badRequest('Failed to create task')))

        if (!created) {
          return yield* Effect.fail(badRequest('Task creation failed'))
        }

        return toTask(created)
      }),

    update: (principal, id, input) =>
      Effect.gen(function* () {
        const workspaceMembershipPort = yield* TaskWorkspaceMembershipPort
        const taskStorePort = yield* TaskStorePort

        const existing = yield* taskStorePort.getById(id).pipe(
          Effect.mapError(() => badRequest('Failed to fetch task'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Task not found'))
        }

        const isMember = yield* workspaceMembershipPort.isMember(existing.workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify workspace membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to update this task'))
        }

        if (!isValidTaskStatus(input.status)) {
          return yield* Effect.fail(badRequest('Invalid task update payload'))
        }

        if (input.title === undefined && input.description === undefined && input.status === undefined) {
          return yield* Effect.fail(badRequest('Task update payload is empty'))
        }

        if (input.title !== undefined && !isValidTaskTitle(input.title)) {
          return yield* Effect.fail(badRequest('Invalid task update payload'))
        }

        const normalizedTitle = input.title?.trim()
        const normalizedDescription = normalizeNullableTaskDescription(input.description)

        if (normalizedDescription !== null && !isValidTaskDescription(normalizedDescription)) {
          return yield* Effect.fail(badRequest('Invalid task update payload'))
        }

        const updated = yield* taskStorePort.update({
          id,
          title: normalizedTitle,
          description: normalizedDescription,
          status: input.status
        }).pipe(Effect.mapError(() => badRequest('Failed to update task')))

        if (!updated) {
          return yield* Effect.fail(notFound('Task not found'))
        }

        return toTask(updated)
      }),

    remove: (principal, id) =>
      Effect.gen(function* () {
        const workspaceMembershipPort = yield* TaskWorkspaceMembershipPort
        const taskStorePort = yield* TaskStorePort

        const existing = yield* taskStorePort.getById(id).pipe(
          Effect.mapError(() => badRequest('Failed to fetch task'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Task not found'))
        }

        const isMember = yield* workspaceMembershipPort.isMember(existing.workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify workspace membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to delete this task'))
        }

        return yield* taskStorePort.remove(id).pipe(
          Effect.mapError(() => badRequest('Failed to delete task'))
        )
      })
  })
)
