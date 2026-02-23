import { and, asc, count, desc, eq, gt, inArray, lt, or } from 'drizzle-orm'
import { type SortOrder, type WorkspaceMemberRole } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { buildCursorPage } from '../pagination.js'
import { workspaceMemberRowSchema } from '../effect-schemas/workspace-members.js'
import { workspaceRowSchema, type WorkspaceRowShape } from '../effect-schemas/workspaces.js'
import { dbDecodeFailed, dbQueryFailed, toDbError, type DbError } from '../errors.js'
import { workspaces, workspaceMembers } from '../schema.js'

interface ListParams {
  readonly cursor?: string
  readonly limit: number
  readonly sortBy: string
  readonly sortOrder: SortOrder
  readonly filter: Readonly<Record<string, string>>
}

const decodeWorkspaceRows = Schema.decodeUnknown(Schema.Array(workspaceRowSchema))
const decodeWorkspaceRow = Schema.decodeUnknown(workspaceRowSchema)
const decodeWorkspaceMemberRow = Schema.decodeUnknown(workspaceMemberRowSchema)
const decodeWorkspaceMemberRows = Schema.decodeUnknown(Schema.Array(workspaceMemberRowSchema))

const decodeNullableWorkspace = (
  value: unknown
): Effect.Effect<WorkspaceRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeWorkspaceRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('workspace row decode failed', error))
  )
}

const parseCountValue = (value: unknown): number => {
  if (typeof value === 'number') {
    return value
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

export const workspacesRepository = {
  list: (userId: string, params: ListParams) => workspacesRepository.listForUser(userId, params),

  listForUser: (userId: string, params: ListParams) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder

        const page = yield* buildCursorPage<WorkspaceRowShape>({
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
                .from(workspaceMembers)
                .where(eq(workspaceMembers.userId, userId))
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count workspaces for user', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              if (sortBy === 'createdAt') {
                const cursorWhere = cursor
                  ? sortOrder === 'asc'
                    ? or(
                        gt(workspaces.createdAt, new Date(cursor.sortValue)),
                        and(eq(workspaces.createdAt, new Date(cursor.sortValue)), gt(workspaces.id, cursor.id))
                      )
                    : or(
                        lt(workspaces.createdAt, new Date(cursor.sortValue)),
                        and(eq(workspaces.createdAt, new Date(cursor.sortValue)), lt(workspaces.id, cursor.id))
                      )
                  : undefined

                const rows = yield* db
                  .select({
                    id: workspaces.id,
                    name: workspaces.name,
                    ownerUserId: workspaces.ownerUserId,
                    organizationId: workspaces.organizationId,
                    createdAt: workspaces.createdAt
                  })
                  .from(workspaces)
                  .innerJoin(workspaceMembers, eq(workspaces.id, workspaceMembers.workspaceId))
                  .where(
                    cursorWhere
                      ? and(eq(workspaceMembers.userId, userId), cursorWhere)
                      : eq(workspaceMembers.userId, userId)
                  )
                  .orderBy(
                    sortOrder === 'asc' ? asc(workspaces.createdAt) : desc(workspaces.createdAt),
                    sortOrder === 'asc' ? asc(workspaces.id) : desc(workspaces.id)
                  )
                  .limit(limitPlusOne)
                  .execute()

                return yield* decodeWorkspaceRows(rows).pipe(
                  Effect.mapError((error) => dbDecodeFailed('workspace list decode failed', error))
                )
              }

              const cursorWhere = cursor
                ? sortOrder === 'asc'
                  ? or(
                      gt(workspaces.name, cursor.sortValue),
                      and(eq(workspaces.name, cursor.sortValue), gt(workspaces.id, cursor.id))
                    )
                  : or(
                      lt(workspaces.name, cursor.sortValue),
                      and(eq(workspaces.name, cursor.sortValue), lt(workspaces.id, cursor.id))
                    )
                : undefined

              const rows = yield* db
                .select({
                  id: workspaces.id,
                  name: workspaces.name,
                  ownerUserId: workspaces.ownerUserId,
                  organizationId: workspaces.organizationId,
                  createdAt: workspaces.createdAt
                })
                .from(workspaces)
                .innerJoin(workspaceMembers, eq(workspaces.id, workspaceMembers.workspaceId))
                .where(
                  cursorWhere
                    ? and(eq(workspaceMembers.userId, userId), cursorWhere)
                    : eq(workspaceMembers.userId, userId)
                )
                .orderBy(
                  sortOrder === 'asc' ? asc(workspaces.name) : desc(workspaces.name),
                  sortOrder === 'asc' ? asc(workspaces.id) : desc(workspaces.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeWorkspaceRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('workspace list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list workspaces for user', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => {
            if (sortBy === 'createdAt') {
              return row.createdAt.toISOString()
            }

            return row.name
          }
        })

        return {
          data: page.data,
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list workspaces for user', error))),

  getById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            id: workspaces.id,
            name: workspaces.name,
            ownerUserId: workspaces.ownerUserId,
            organizationId: workspaces.organizationId,
            createdAt: workspaces.createdAt
          })
          .from(workspaces)
          .where(eq(workspaces.id, id))
          .limit(1)
          .execute()

        return yield* decodeNullableWorkspace(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch workspace by id', error))),

  getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        if (ids.length === 0) {
          return [] as const
        }

        const db = yield* DB
        const rows = yield* db
          .select({
            id: workspaces.id,
            name: workspaces.name,
            ownerUserId: workspaces.ownerUserId,
            organizationId: workspaces.organizationId,
            createdAt: workspaces.createdAt
          })
          .from(workspaces)
          .innerJoin(workspaceMembers, eq(workspaces.id, workspaceMembers.workspaceId))
          .where(and(eq(workspaceMembers.userId, userId), inArray(workspaces.id, [...ids])))
          .execute()

        return yield* decodeWorkspaceRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('workspace list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch workspaces by ids for user', error))),

  create: (input: { name: string; ownerUserId: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const workspaceRows = yield* db.insert(workspaces).values(input).returning().execute()
        return yield* decodeNullableWorkspace(workspaceRows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create workspace', error))),

  update: (input: { id: string; name?: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        if (input.name === undefined) {
          const existingRows = yield* db
            .select({
              id: workspaces.id,
              name: workspaces.name,
              ownerUserId: workspaces.ownerUserId,
              organizationId: workspaces.organizationId,
              createdAt: workspaces.createdAt
            })
            .from(workspaces)
            .where(eq(workspaces.id, input.id))
            .limit(1)
            .execute()

          return yield* decodeNullableWorkspace(existingRows[0] ?? null)
        }

        const rows = yield* db
          .update(workspaces)
          .set({ name: input.name })
          .where(eq(workspaces.id, input.id))
          .returning()
          .execute()

        return yield* decodeNullableWorkspace(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update workspace', error))),

  remove: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(workspaces)
          .where(eq(workspaces.id, id))
          .returning({ id: workspaces.id })
          .execute()

        if (rows.length === 0) {
          return yield* Effect.fail(dbQueryFailed('Workspace row not found', new Error(id)))
        }

        return { deleted: true as const }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete workspace', error))),

  isMember: (workspaceId: string, userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const members = yield* db
          .select()
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
          .limit(1)
          .execute()
        const member = members[0]

        if (!member) {
          return false
        }

        yield* decodeWorkspaceMemberRow(member).pipe(
          Effect.mapError((error) => dbDecodeFailed('workspace member decode failed', error))
        )
        return true
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to verify workspace membership', error))),

  getMemberRole: (workspaceId: string, userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const members = yield* db
          .select()
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
          .limit(1)
          .execute()

        const member = members[0]
        if (!member) {
          return null
        }

        const decoded = yield* decodeWorkspaceMemberRow(member).pipe(
          Effect.mapError((error) => dbDecodeFailed('workspace member decode failed', error))
        )

        return decoded.role
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get workspace member role', error))),

  getMemberRolesForUser: (userId: string, workspaceIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        if (workspaceIds.length === 0) {
          return new Map<string, WorkspaceMemberRole>()
        }

        const db = yield* DB
        const members = yield* db
          .select()
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.workspaceId, [...workspaceIds])))
          .execute()

        const decoded = yield* decodeWorkspaceMemberRows(members).pipe(
          Effect.mapError((error) => dbDecodeFailed('workspace member list decode failed', error))
        )

        return new Map(decoded.map((row) => [row.workspaceId, row.role] as const))
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get workspace member roles for user', error))),

  countOwnedByUser: (userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            count: count()
          })
          .from(workspaces)
          .where(eq(workspaces.ownerUserId, userId))
          .execute()

        return parseCountValue(rows[0]?.count)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to count owned workspaces', error)))
}
