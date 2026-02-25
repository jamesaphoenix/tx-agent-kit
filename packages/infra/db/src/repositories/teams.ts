import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  lt,
  or,
  type SQL
} from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { buildCursorPage } from '../pagination.js'
import { teamRowSchema, type TeamRowShape } from '../effect-schemas/teams.js'
import { teamMemberRowSchema, type TeamMemberRowShape } from '../effect-schemas/team-members.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { teams, teamMembers } from '../schema.js'
import type { ListParams } from './list-params.js'

const decodeTeamRows = Schema.decodeUnknown(Schema.Array(teamRowSchema))
const decodeTeamRow = Schema.decodeUnknown(teamRowSchema)
const decodeTeamMemberRows = Schema.decodeUnknown(Schema.Array(teamMemberRowSchema))
const decodeTeamMemberRow = Schema.decodeUnknown(teamMemberRowSchema)

const decodeNullableTeam = (
  value: unknown
): Effect.Effect<TeamRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeTeamRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('team row decode failed', error))
  )
}

const decodeNullableTeamMember = (
  value: unknown
): Effect.Effect<TeamMemberRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeTeamMemberRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('team member row decode failed', error))
  )
}

const parseCountValue = (value: unknown): number => {
  if (typeof value === 'number') {
    return value
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

export const teamsRepository = {
  list: (organizationId: string, params: ListParams) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere: SQL<unknown> = eq(teams.organizationId, organizationId)

        const page = yield* buildCursorPage<TeamRowShape>({
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
                .from(teams)
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count teams for organization', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              if (sortBy === 'name') {
                const cursorWhere = cursor
                  ? sortOrder === 'asc'
                    ? or(
                        gt(teams.name, cursor.sortValue),
                        and(eq(teams.name, cursor.sortValue), gt(teams.id, cursor.id))
                      )
                    : or(
                        lt(teams.name, cursor.sortValue),
                        and(eq(teams.name, cursor.sortValue), lt(teams.id, cursor.id))
                      )
                  : undefined

                const rows = yield* db
                  .select({
                    id: teams.id,
                    organizationId: teams.organizationId,
                    name: teams.name,
                    website: teams.website,
                    brandSettings: teams.brandSettings,
                    createdAt: teams.createdAt,
                    updatedAt: teams.updatedAt
                  })
                  .from(teams)
                  .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                  .orderBy(
                    sortOrder === 'asc' ? asc(teams.name) : desc(teams.name),
                    sortOrder === 'asc' ? asc(teams.id) : desc(teams.id)
                  )
                  .limit(limitPlusOne)
                  .execute()

                return yield* decodeTeamRows(rows).pipe(
                  Effect.mapError((error) => dbDecodeFailed('team list decode failed', error))
                )
              }

              const cursorWhere = cursor
                ? sortOrder === 'asc'
                  ? or(
                      gt(teams.createdAt, new Date(cursor.sortValue)),
                      and(eq(teams.createdAt, new Date(cursor.sortValue)), gt(teams.id, cursor.id))
                    )
                  : or(
                      lt(teams.createdAt, new Date(cursor.sortValue)),
                      and(eq(teams.createdAt, new Date(cursor.sortValue)), lt(teams.id, cursor.id))
                    )
                : undefined

              const rows = yield* db
                .select({
                  id: teams.id,
                  organizationId: teams.organizationId,
                  name: teams.name,
                  website: teams.website,
                  brandSettings: teams.brandSettings,
                  createdAt: teams.createdAt,
                  updatedAt: teams.updatedAt
                })
                .from(teams)
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(teams.createdAt) : desc(teams.createdAt),
                  sortOrder === 'asc' ? asc(teams.id) : desc(teams.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeTeamRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('team list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list teams for organization', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => {
            if (sortBy === 'name') {
              return row.name
            }

            return row.createdAt.toISOString()
          }
        })

        return {
          data: page.data,
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list teams for organization', error))),

  getById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            id: teams.id,
            organizationId: teams.organizationId,
            name: teams.name,
            website: teams.website,
            brandSettings: teams.brandSettings,
            createdAt: teams.createdAt,
            updatedAt: teams.updatedAt
          })
          .from(teams)
          .where(eq(teams.id, id))
          .limit(1)
          .execute()

        return yield* decodeNullableTeam(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch team by id', error))),

  create: (input: { organizationId: string; name: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(teams)
          .values({
            organizationId: input.organizationId,
            name: input.name
          })
          .returning()
          .execute()

        return yield* decodeNullableTeam(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create team', error))),

  update: (input: { id: string; name?: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const patch: { name?: string } = {}

        if (input.name !== undefined) {
          patch.name = input.name
        }

        if (Object.keys(patch).length === 0) {
          const rows = yield* db
            .select({
              id: teams.id,
              organizationId: teams.organizationId,
              name: teams.name,
              website: teams.website,
              brandSettings: teams.brandSettings,
              createdAt: teams.createdAt,
              updatedAt: teams.updatedAt
            })
            .from(teams)
            .where(eq(teams.id, input.id))
            .limit(1)
            .execute()

          return yield* decodeNullableTeam(rows[0] ?? null)
        }

        const rows = yield* db
          .update(teams)
          .set(patch)
          .where(eq(teams.id, input.id))
          .returning()
          .execute()

        return yield* decodeNullableTeam(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update team', error))),

  remove: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(teams)
          .where(eq(teams.id, id))
          .returning()
          .execute()

        return yield* decodeNullableTeam(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete team', error))),

  addMember: (input: { teamId: string; userId: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(teamMembers)
          .values({
            teamId: input.teamId,
            userId: input.userId
          })
          .returning()
          .execute()

        return yield* decodeNullableTeamMember(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to add team member', error))),

  removeMember: (teamId: string, userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(teamMembers)
          .where(and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          ))
          .returning()
          .execute()

        return yield* decodeNullableTeamMember(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to remove team member', error))),

  listMembers: (teamId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            id: teamMembers.id,
            teamId: teamMembers.teamId,
            userId: teamMembers.userId,
            roleId: teamMembers.roleId,
            createdAt: teamMembers.createdAt,
            updatedAt: teamMembers.updatedAt
          })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, teamId))
          .execute()

        return yield* decodeTeamMemberRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('team member list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list team members', error)))
}
