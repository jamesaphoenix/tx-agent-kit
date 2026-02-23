import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import { taskStatuses, type SortOrder, type TaskStatus } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { buildCursorPage } from '../pagination.js'
import { taskRowSchema, type TaskRowShape } from '../effect-schemas/tasks.js'
import { dbDecodeFailed, dbQueryFailed, toDbError, type DbError } from '../errors.js'
import { tasks, workspaceMembers } from '../schema.js'

interface ListParams {
  readonly cursor?: string
  readonly limit: number
  readonly sortBy: string
  readonly sortOrder: SortOrder
  readonly filter: Readonly<Record<string, string>>
}

const decodeTaskRows = Schema.decodeUnknown(Schema.Array(taskRowSchema))
const decodeTaskRow = Schema.decodeUnknown(taskRowSchema)

const decodeNullableTask = (
  value: unknown
): Effect.Effect<TaskRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeTaskRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('tasks row decode failed', error))
  )
}

const parseCountValue = (value: unknown): number => {
  if (typeof value === 'number') {
    return value
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

const combinePredicates = (predicates: ReadonlyArray<SQL<unknown>>): SQL<unknown> => {
  const [first, ...rest] = predicates

  if (!first) {
    return sql`true`
  }

  return rest.reduce<SQL<unknown>>((acc, predicate) => and(acc, predicate) ?? acc, first)
}

const isTaskStatus = (value: string): value is TaskStatus =>
  taskStatuses.some((status) => status === value)

const defaultTaskStatus: TaskStatus = taskStatuses[0]

const buildFilterWhere = (workspaceId: string, params: ListParams): SQL<unknown> => {
  const predicates: Array<SQL<unknown>> = [eq(tasks.workspaceId, workspaceId)]

  const status = params.filter.status
  if (status && isTaskStatus(status)) {
    predicates.push(eq(tasks.status, status))
  }

  const createdByUserId = params.filter.createdByUserId
  if (createdByUserId) {
    predicates.push(eq(tasks.createdByUserId, createdByUserId))
  }

  return combinePredicates(predicates)
}

export const tasksRepository = {
  list: (workspaceId: string, params: ListParams) => tasksRepository.listByWorkspace(workspaceId, params),

  listByWorkspace: (workspaceId: string, params: ListParams) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere = buildFilterWhere(workspaceId, params)

        const page = yield* buildCursorPage({
          cursor: params.cursor,
          limit: params.limit,
          sortBy,
          sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db
                .select({
                  count: count()
                })
                .from(tasks)
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count tasks by workspace', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              if (sortBy === 'createdAt') {
                const cursorWhere = cursor
                  ? sortOrder === 'asc'
                    ? or(
                        gt(tasks.createdAt, new Date(cursor.sortValue)),
                        and(eq(tasks.createdAt, new Date(cursor.sortValue)), gt(tasks.id, cursor.id))
                      )
                    : or(
                        lt(tasks.createdAt, new Date(cursor.sortValue)),
                        and(eq(tasks.createdAt, new Date(cursor.sortValue)), lt(tasks.id, cursor.id))
                      )
                  : undefined

                const rows = yield* db
                  .select({
                    id: tasks.id,
                    workspaceId: tasks.workspaceId,
                    title: tasks.title,
                    description: tasks.description,
                    status: tasks.status,
                    createdByUserId: tasks.createdByUserId,
                    createdAt: tasks.createdAt
                  })
                  .from(tasks)
                  .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                  .orderBy(
                    sortOrder === 'asc' ? asc(tasks.createdAt) : desc(tasks.createdAt),
                    sortOrder === 'asc' ? asc(tasks.id) : desc(tasks.id)
                  )
                  .limit(limitPlusOne)
                  .execute()

                return rows
              }

              if (sortBy === 'title') {
                const cursorWhere = cursor
                  ? sortOrder === 'asc'
                    ? or(
                        gt(tasks.title, cursor.sortValue),
                        and(eq(tasks.title, cursor.sortValue), gt(tasks.id, cursor.id))
                      )
                    : or(
                        lt(tasks.title, cursor.sortValue),
                        and(eq(tasks.title, cursor.sortValue), lt(tasks.id, cursor.id))
                      )
                  : undefined

                const rows = yield* db
                  .select({
                    id: tasks.id,
                    workspaceId: tasks.workspaceId,
                    title: tasks.title,
                    description: tasks.description,
                    status: tasks.status,
                    createdByUserId: tasks.createdByUserId,
                    createdAt: tasks.createdAt
                  })
                  .from(tasks)
                  .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                  .orderBy(
                    sortOrder === 'asc' ? asc(tasks.title) : desc(tasks.title),
                    sortOrder === 'asc' ? asc(tasks.id) : desc(tasks.id)
                  )
                  .limit(limitPlusOne)
                  .execute()

                return rows
              }

              const cursorStatus = cursor ? (isTaskStatus(cursor.sortValue) ? cursor.sortValue : null) : null
              if (cursor && cursorStatus === null) {
                return []
              }

              const cursorWhere = cursor
                ? sortOrder === 'asc'
                  ? or(
                      gt(tasks.status, cursorStatus ?? defaultTaskStatus),
                      and(eq(tasks.status, cursorStatus ?? defaultTaskStatus), gt(tasks.id, cursor.id))
                    )
                  : or(
                      lt(tasks.status, cursorStatus ?? defaultTaskStatus),
                      and(eq(tasks.status, cursorStatus ?? defaultTaskStatus), lt(tasks.id, cursor.id))
                    )
                : undefined

              const rows = yield* db
                .select({
                  id: tasks.id,
                  workspaceId: tasks.workspaceId,
                  title: tasks.title,
                  description: tasks.description,
                  status: tasks.status,
                  createdByUserId: tasks.createdByUserId,
                  createdAt: tasks.createdAt
                })
                .from(tasks)
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(tasks.status) : desc(tasks.status),
                  sortOrder === 'asc' ? asc(tasks.id) : desc(tasks.id)
                )
                .limit(limitPlusOne)
                .execute()

              return rows
            }).pipe(Effect.mapError((error) => toDbError('Failed to list tasks by workspace', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => {
            if (sortBy === 'createdAt') {
              return row.createdAt.toISOString()
            }

            if (sortBy === 'title') {
              return row.title
            }

            return row.status
          }
        })

        const decoded = yield* decodeTaskRows(page.data).pipe(
          Effect.mapError((error) => dbDecodeFailed('tasks list decode failed', error))
        )

        return {
          data: decoded,
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list tasks by workspace', error))),

  getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        if (ids.length === 0) {
          return [] as ReadonlyArray<TaskRowShape>
        }

        const db = yield* DB
        const rows = yield* db
          .select({
            id: tasks.id,
            workspaceId: tasks.workspaceId,
            title: tasks.title,
            description: tasks.description,
            status: tasks.status,
            createdByUserId: tasks.createdByUserId,
            createdAt: tasks.createdAt
          })
          .from(tasks)
          .innerJoin(workspaceMembers, eq(tasks.workspaceId, workspaceMembers.workspaceId))
          .where(and(eq(workspaceMembers.userId, userId), inArray(tasks.id, [...ids])))
          .execute()

        return yield* decodeTaskRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('tasks rows decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch tasks by ids for user', error))),

  getById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            id: tasks.id,
            workspaceId: tasks.workspaceId,
            title: tasks.title,
            description: tasks.description,
            status: tasks.status,
            createdByUserId: tasks.createdByUserId,
            createdAt: tasks.createdAt
          })
          .from(tasks)
          .where(eq(tasks.id, id))
          .limit(1)
          .execute()

        return yield* decodeNullableTask(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch task by id', error))),

  create: (input: { workspaceId: string; title: string; description?: string; createdByUserId: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(tasks)
          .values({
            workspaceId: input.workspaceId,
            title: input.title,
            description: input.description ?? null,
            createdByUserId: input.createdByUserId,
            status: 'todo'
          })
          .returning()
          .execute()

        return yield* decodeNullableTask(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create task', error))),

  update: (input: {
    id: string
    title?: string
    description?: string | null
    status?: TaskStatus
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const patch: {
          title?: string
          description?: string | null
          status?: TaskStatus
        } = {}

        if (input.title !== undefined) {
          patch.title = input.title
        }

        if (input.description !== undefined) {
          patch.description = input.description
        }

        if (input.status !== undefined) {
          patch.status = input.status
        }

        if (Object.keys(patch).length === 0) {
          const existingRows = yield* db
            .select({
              id: tasks.id,
              workspaceId: tasks.workspaceId,
              title: tasks.title,
              description: tasks.description,
              status: tasks.status,
              createdByUserId: tasks.createdByUserId,
              createdAt: tasks.createdAt
            })
            .from(tasks)
            .where(eq(tasks.id, input.id))
            .limit(1)
            .execute()

          return yield* decodeNullableTask(existingRows[0] ?? null)
        }

        const rows = yield* db
          .update(tasks)
          .set(patch)
          .where(eq(tasks.id, input.id))
          .returning()
          .execute()

        return yield* decodeNullableTask(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update task', error))),

  remove: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(tasks)
          .where(eq(tasks.id, id))
          .returning({ id: tasks.id })
          .execute()

        if (rows.length === 0) {
          return yield* Effect.fail(dbQueryFailed('Task row not found', new Error(id)))
        }

        return { deleted: true as const }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete task', error)))
}
