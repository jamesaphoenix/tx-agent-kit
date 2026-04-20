import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  sql,
  type SQL
} from 'drizzle-orm'
import type { DomainEventAggregateType, DomainEventType, MemberRole } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { buildCursorCondition, buildCursorPage } from '../pagination.js'
import { teamRowSchema, type TeamRowShape } from '../effect-schemas/teams.js'
import { teamMemberRowSchema, type TeamMemberRowShape } from '../effect-schemas/team-members.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { teams, teamMembers, teamMediaAssets, type BrandSettingsPayload, type JsonObject } from '../schema.js'
import { insertDomainEventInTransaction } from './domain-events.js'
import type { ListParams } from './list-params.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder, parseCountValue } from './sql-helpers.js'

const decodeTeamRows = Schema.decodeUnknown(Schema.Array(teamRowSchema))
const decodeMemberRows = Schema.decodeUnknown(Schema.Array(teamMemberRowSchema))
const decodeTeam = createOptionalDecoder(teamRowSchema, 'team row')
const decodeMember = createOptionalDecoder(teamMemberRowSchema, 'team member row')

export const teamsRepository = {
  list: (organizationId: string, params: ListParams) =>
    withDb('Failed to list teams for organization', (db) =>
      Effect.gen(function* () {
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere: SQL = eq(teams.organizationId, organizationId)

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
                const cursorWhere = buildCursorCondition(cursor, sortOrder, teams.name, cursor?.sortValue ?? '', teams.id)

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

              const cursorWhere = buildCursorCondition(cursor, sortOrder, teams.createdAt, cursor ? new Date(cursor.sortValue) : new Date(), teams.id)

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
    ),

  listForMember: (organizationId: string, userId: string, params: ListParams) =>
    withDb('Failed to list teams for organization member', (db) =>
      Effect.gen(function* () {
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere = and(
          eq(teams.organizationId, organizationId),
          eq(teamMembers.userId, userId),
          isNull(teamMembers.disabledAt)
        )

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
                .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count teams for organization member', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              if (sortBy === 'name') {
                const cursorWhere = buildCursorCondition(cursor, sortOrder, teams.name, cursor?.sortValue ?? '', teams.id)

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
                  .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
                  .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                  .orderBy(
                    sortOrder === 'asc' ? asc(teams.name) : desc(teams.name),
                    sortOrder === 'asc' ? asc(teams.id) : desc(teams.id)
                  )
                  .limit(limitPlusOne)
                  .execute()

                return yield* decodeTeamRows(rows).pipe(
                  Effect.mapError((error) => dbDecodeFailed('member team list decode failed', error))
                )
              }

              const cursorWhere = buildCursorCondition(cursor, sortOrder, teams.createdAt, cursor ? new Date(cursor.sortValue) : new Date(), teams.id)

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
                .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(teams.createdAt) : desc(teams.createdAt),
                  sortOrder === 'asc' ? asc(teams.id) : desc(teams.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeTeamRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('member team list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list teams for organization member', error))),
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
    ),

  getById: (id: string) =>
    withDb('Failed to fetch team by id', (db) =>
      Effect.gen(function* () {
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

        return yield* decodeFirst(rows, decodeTeam)
      })
    ),

  create: (input: { organizationId: string; name: string; website?: string | null; brandSettings?: BrandSettingsPayload | null }) =>
    withDb('Failed to create team', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(teams)
          .values({
            organizationId: input.organizationId,
            name: input.name,
            website: input.website ?? null,
            brandSettings: input.brandSettings
          })
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeTeam)
      })
    ),

  update: (input: { id: string; name?: string; website?: string | null; brandSettings?: BrandSettingsPayload | null }) =>
    withDb('Failed to update team', (db) =>
      Effect.gen(function* () {
        const patch: { name?: string; website?: string | null; brandSettings?: BrandSettingsPayload | null } = {}

        if (input.name !== undefined) {
          patch.name = input.name
        }

        if (input.website !== undefined) {
          patch.website = input.website
        }

        if (input.brandSettings !== undefined) {
          patch.brandSettings = input.brandSettings
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

          return yield* decodeFirst(rows, decodeTeam)
        }

        // tenant-scope: service-validated
        const rows = yield* db
          .update(teams)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(teams.id, input.id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeTeam)
      })
    ),

  remove: (id: string) =>
    withDb('Failed to delete team', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .delete(teams)
          .where(eq(teams.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeTeam)
      })
    ),

  removeWithEvent: (input: {
    id: string
    event: {
      eventType: DomainEventType
      aggregateType: DomainEventAggregateType
      payload: JsonObject
      correlationId?: string | null
    }
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        yield* db.transaction((trx) =>
          Effect.gen(function* () {
            // Collect R2 storage paths BEFORE cascade delete removes asset rows
            const assetRows = yield* trx
              .select({
                storagePath: teamMediaAssets.storagePath,
                thumbnailPath: teamMediaAssets.thumbnailPath
              })
              .from(teamMediaAssets)
              .where(eq(teamMediaAssets.teamId, input.id))
              .execute()

            const storagePaths = assetRows.flatMap((a) =>
              [a.storagePath, ...(a.thumbnailPath ? [a.thumbnailPath] : [])]
            )

            yield* insertDomainEventInTransaction(trx, {
              eventType: input.event.eventType,
              aggregateType: input.event.aggregateType,
              aggregateId: input.id,
              payload: { ...input.event.payload, storagePaths },
              correlationId: input.event.correlationId ?? null
            })

            // tenant-scope: service-validated (cascade deletes team_members, assets, etc.)
            yield* trx
              .delete(teams)
              .where(eq(teams.id, input.id))
              .execute()
          })
        )

        return { deleted: true as const }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete team with event', error))),

  addMember: (input: { teamId: string; userId: string; role?: MemberRole }) =>
    withDb('Failed to add team member', (db) =>
      Effect.gen(function* () {
        const values: { teamId: string; userId: string; role?: MemberRole } = {
          teamId: input.teamId,
          userId: input.userId
        }
        if (input.role) {
          values.role = input.role
        }

        // When a role is specified, use onConflictDoUpdate to promote existing members
        // (e.g., trigger adds as 'member', then service promotes to 'admin')
        const rows = input.role
          ? yield* db
              .insert(teamMembers)
              .values(values)
              .onConflictDoUpdate({
                target: [teamMembers.teamId, teamMembers.userId],
                set: { role: input.role, updatedAt: sql`now()` }
              })
              .returning()
              .execute()
          : yield* db
              .insert(teamMembers)
              .values(values)
              .onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.userId] })
              .returning()
              .execute()

        // If conflict with no role specified, fetch the existing row
        if (rows.length === 0) {
          const existing = yield* db
            .select({
              id: teamMembers.id,
              teamId: teamMembers.teamId,
              userId: teamMembers.userId,
              roleId: teamMembers.roleId,
              role: teamMembers.role,
              disabledAt: teamMembers.disabledAt,
              createdAt: teamMembers.createdAt,
              updatedAt: teamMembers.updatedAt
            })
            .from(teamMembers)
            .where(and(
              eq(teamMembers.teamId, input.teamId),
              eq(teamMembers.userId, input.userId)
            ))
            .limit(1)
            .execute()

          return yield* decodeFirst(existing, decodeMember)
        }

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  removeMember: (teamId: string, userId: string) =>
    withDb('Failed to remove team member', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(teamMembers)
          .where(and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          ))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  listMembers: (teamId: string, params: ListParams) =>
    withDb('Failed to list team members', (db) =>
      Effect.gen(function* () {
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere: SQL = eq(teamMembers.teamId, teamId)

        const page = yield* buildCursorPage<TeamMemberRowShape>({
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
                .from(teamMembers)
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count team members', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              const cursorWhere = buildCursorCondition(cursor, sortOrder, teamMembers.createdAt, cursor ? new Date(cursor.sortValue) : new Date(), teamMembers.id)

              const rows = yield* db
                .select({
                  id: teamMembers.id,
                  teamId: teamMembers.teamId,
                  userId: teamMembers.userId,
                  roleId: teamMembers.roleId,
                  role: teamMembers.role,
                  disabledAt: teamMembers.disabledAt,
                  createdAt: teamMembers.createdAt,
                  updatedAt: teamMembers.updatedAt
                })
                .from(teamMembers)
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(teamMembers.createdAt) : desc(teamMembers.createdAt),
                  sortOrder === 'asc' ? asc(teamMembers.id) : desc(teamMembers.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeMemberRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('team member list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list team members', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => row.createdAt.toISOString()
        })

        return {
          data: page.data,
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    ),

  getMemberByTeamAndUser: (teamId: string, userId: string) =>
    withDb('Failed to get team member by team and user', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            id: teamMembers.id,
            teamId: teamMembers.teamId,
            userId: teamMembers.userId,
            roleId: teamMembers.roleId,
            role: teamMembers.role,
            disabledAt: teamMembers.disabledAt,
            createdAt: teamMembers.createdAt,
            updatedAt: teamMembers.updatedAt
          })
          .from(teamMembers)
          .where(and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          ))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  disableTeamMember: (teamId: string, userId: string) =>
    withDb('Failed to disable team member', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(teamMembers)
          .set({ disabledAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          ))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  enableTeamMember: (teamId: string, userId: string) =>
    withDb('Failed to enable team member', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(teamMembers)
          .set({ disabledAt: null, updatedAt: sql`now()` })
          .where(and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          ))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  getMemberById: (id: string) =>
    withDb('Failed to get team member by id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            id: teamMembers.id,
            teamId: teamMembers.teamId,
            userId: teamMembers.userId,
            roleId: teamMembers.roleId,
            role: teamMembers.role,
            disabledAt: teamMembers.disabledAt,
            createdAt: teamMembers.createdAt,
            updatedAt: teamMembers.updatedAt
          })
          .from(teamMembers)
          .where(eq(teamMembers.id, id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  updateMemberRole: (id: string, roleId: string | null) =>
    withDb('Failed to update team member role', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(teamMembers)
          .set({ roleId, updatedAt: sql`now()` })
          .where(eq(teamMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  disableMemberById: (id: string) =>
    withDb('Failed to disable team member by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(teamMembers)
          .set({ disabledAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(teamMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  enableMemberById: (id: string) =>
    withDb('Failed to enable team member by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(teamMembers)
          .set({ disabledAt: null, updatedAt: sql`now()` })
          .where(eq(teamMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  removeMemberById: (id: string) =>
    withDb('Failed to remove team member by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .delete(teamMembers)
          .where(eq(teamMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    )
}
