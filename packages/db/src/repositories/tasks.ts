import { desc, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { taskRowSchema, type TaskRowShape } from '../effect-schemas/tasks.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { tasks } from '../schema.js'

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

export const tasksRepository = {
  listByWorkspace: (workspaceId: string) =>
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
          .where(eq(tasks.workspaceId, workspaceId))
          .orderBy(desc(tasks.createdAt))
          .execute()

        return yield* decodeTaskRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('tasks list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list tasks by workspace', error))),

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
    ).pipe(Effect.mapError((error) => toDbError('Failed to create task', error)))
}
