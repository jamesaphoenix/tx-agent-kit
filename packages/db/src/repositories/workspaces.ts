import { and, count, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { workspaceMemberRowSchema } from '../effect-schemas/workspace-members.js'
import { workspaceRowSchema, type WorkspaceRowShape } from '../effect-schemas/workspaces.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { workspaces, workspaceMembers } from '../schema.js'

const decodeWorkspaceRows = Schema.decodeUnknown(Schema.Array(workspaceRowSchema))
const decodeWorkspaceRow = Schema.decodeUnknown(workspaceRowSchema)
const decodeWorkspaceMemberRow = Schema.decodeUnknown(workspaceMemberRowSchema)

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

export const workspacesRepository = {
  listForUser: (userId: string) =>
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
          .innerJoin(workspaceMembers, eq(workspaces.id, workspaceMembers.workspaceId))
          .where(eq(workspaceMembers.userId, userId))
          .execute()

        return yield* decodeWorkspaceRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('workspace list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list workspaces for user', error))),

  create: (input: { name: string; ownerUserId: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const workspaceRows = yield* db.insert(workspaces).values(input).returning().execute()
        return yield* decodeNullableWorkspace(workspaceRows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create workspace', error))),

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

        const countValue = rows[0]?.count ?? 0
        if (typeof countValue === 'number') {
          return countValue
        }

        const parsed = Number.parseInt(String(countValue), 10)
        return Number.isNaN(parsed) ? 0 : parsed
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to count owned workspaces', error)))
}
