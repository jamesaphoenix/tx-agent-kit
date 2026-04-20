import crypto from 'node:crypto'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import {
  invitationStatuses,
  orgMemberRoles,
  type InvitationAssignableRole,
  type InvitationRole,
  type InvitationStatus,
  type MembershipType
} from '@tx-agent-kit/contracts'
import { Effect, Option, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { buildCursorCondition, buildCursorPage } from '../pagination.js'
import { invitationRowSchema, type InvitationRowShape } from '../effect-schemas/invitations.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { invitations, orgMembers, teamMembers, teams } from '../schema.js'
import type { ListParams } from './list-params.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { combinePredicates, createOptionalDecoder, parseCountValue } from './sql-helpers.js'

const decodeInvitationRows = Schema.decodeUnknown(Schema.Array(invitationRowSchema))
const decode = createOptionalDecoder(invitationRowSchema, 'invitation row')

const invitationSelectColumns = {
  id: invitations.id,
  organizationId: invitations.organizationId,
  inviteeUserId: invitations.inviteeUserId,
  email: invitations.email,
  role: invitations.role,
  status: invitations.status,
  invitedByUserId: invitations.invitedByUserId,
  token: invitations.token,
  expiresAt: invitations.expiresAt,
  revokedAt: invitations.revokedAt,
  revokedByUserId: invitations.revokedByUserId,
  teamId: invitations.teamId,
  membershipType: invitations.membershipType,
  createdAt: invitations.createdAt
} as const

const isInvitationStatus = (value: string): value is InvitationStatus =>
  invitationStatuses.some((status) => status === value)

const isInvitationRole = (value: string): value is InvitationRole =>
  orgMemberRoles.some((role) => role === value)

const normalizeInvitationEmail = (email: string): string => email.trim().toLowerCase()

const buildListWhere = (inviteeUserId: string, inviteeEmail: string, params: ListParams): SQL => {
  const inviteeIdentityWhere = or(
    eq(invitations.inviteeUserId, inviteeUserId),
    eq(invitations.email, normalizeInvitationEmail(inviteeEmail))
  )
  const predicates: Array<SQL> = inviteeIdentityWhere ? [inviteeIdentityWhere] : []

  const status = params.filter.status
  if (status && isInvitationStatus(status)) {
    predicates.push(eq(invitations.status, status))
  }

  const role = params.filter.role
  if (role && isInvitationRole(role)) {
    predicates.push(eq(invitations.role, role))
  }

  return combinePredicates(predicates)
}

const buildOrgListWhere = (organizationId: string, params: ListParams): SQL => {
  const predicates: Array<SQL> = [eq(invitations.organizationId, organizationId)]

  const status = params.filter.status
  if (status && isInvitationStatus(status)) {
    predicates.push(eq(invitations.status, status))
  }

  const role = params.filter.role
  if (role && isInvitationRole(role)) {
    predicates.push(eq(invitations.role, role))
  }

  return combinePredicates(predicates)
}

export const invitationsRepository = {
  listForInviteeUserId: (inviteeUserId: string, inviteeEmail: string, params: ListParams) =>
    withDb('Failed to list invitations for invitee', (db) =>
      Effect.gen(function* () {
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere = buildListWhere(inviteeUserId, inviteeEmail, params)

        const page = yield* buildCursorPage<InvitationRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy,
          sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              // tenant-scope: service-validated (baseWhere includes inviteeUserId scope)
              const rows = yield* db
                .select({
                  count: count()
                })
                .from(invitations)
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count invitations for invitee', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              if (sortBy === 'expiresAt') {
                const cursorWhere = buildCursorCondition(cursor, sortOrder, invitations.expiresAt, cursor ? new Date(cursor.sortValue) : new Date(), invitations.id)

                // tenant-scope: service-validated (baseWhere includes inviteeUserId scope)
                const rows = yield* db
                  .select(invitationSelectColumns)
                  .from(invitations)
                  .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                  .orderBy(
                    sortOrder === 'asc' ? asc(invitations.expiresAt) : desc(invitations.expiresAt),
                    sortOrder === 'asc' ? asc(invitations.id) : desc(invitations.id)
                  )
                  .limit(limitPlusOne)
                  .execute()

                return yield* decodeInvitationRows(rows).pipe(
                  Effect.mapError((error) => dbDecodeFailed('invitation list decode failed', error))
                )
              }

              const cursorWhere = buildCursorCondition(cursor, sortOrder, invitations.createdAt, cursor ? new Date(cursor.sortValue) : new Date(), invitations.id)

              // tenant-scope: service-validated (baseWhere includes inviteeUserId scope)
              const rows = yield* db
                .select(invitationSelectColumns)
                .from(invitations)
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(invitations.createdAt) : desc(invitations.createdAt),
                  sortOrder === 'asc' ? asc(invitations.id) : desc(invitations.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeInvitationRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('invitation list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list invitations for invitee', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => {
            if (sortBy === 'expiresAt') {
              return row.expiresAt.toISOString()
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

  listForOrganization: (organizationId: string, params: ListParams) =>
    withDb('Failed to list invitations for organization', (db) =>
      Effect.gen(function* () {
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere = buildOrgListWhere(organizationId, params)

        const page = yield* buildCursorPage<InvitationRowShape>({
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
                .from(invitations)
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count invitations for organization', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              const sortColumn = sortBy === 'expiresAt' ? invitations.expiresAt : invitations.createdAt
              const cursorWhere = buildCursorCondition(cursor, sortOrder, sortColumn, cursor ? new Date(cursor.sortValue) : new Date(), invitations.id)

              const rows = yield* db
                .select(invitationSelectColumns)
                .from(invitations)
                .where(and(eq(invitations.organizationId, organizationId), cursorWhere ? and(baseWhere, cursorWhere) : baseWhere))
                .orderBy(
                  sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn),
                  sortOrder === 'asc' ? asc(invitations.id) : desc(invitations.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeInvitationRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('invitation list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list invitations for organization', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => {
            if (sortBy === 'expiresAt') {
              return row.expiresAt.toISOString()
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
    withDb('Failed to fetch invitation by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .select(invitationSelectColumns)
          .from(invitations)
          .where(eq(invitations.id, id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  teamBelongsToOrganization: (teamId: string, organizationId: string) =>
    withDb('Failed to validate invitation workspace scope', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: teams.id })
          .from(teams)
          .where(and(
            eq(teams.id, teamId),
            eq(teams.organizationId, organizationId)
          ))
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ),

  pendingInvitationExists: (input: { organizationId: string; email: string; teamId?: string }) =>
    withDb('Failed to check pending invitation scope', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: invitations.id })
          .from(invitations)
          .where(and(
            eq(invitations.organizationId, input.organizationId),
            eq(invitations.email, normalizeInvitationEmail(input.email)),
            eq(invitations.status, 'pending'),
            input.teamId ? eq(invitations.teamId, input.teamId) : isNull(invitations.teamId)
          ))
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ),

  getManyByIds: (ids: ReadonlyArray<string>) =>
    withDb('Failed to fetch invitations by ids', (db) =>
      Effect.gen(function* () {
        if (ids.length === 0) {
          return [] as const
        }

        // tenant-scope: service-validated
        const rows = yield* db
          .select(invitationSelectColumns)
          .from(invitations)
          .where(inArray(invitations.id, [...ids]))
          .execute()

        return yield* decodeInvitationRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('invitation list decode failed', error))
        )
      })
    ),

  create: (input: {
    organizationId: string
    inviteeUserId: string | null
    email: string
    role: InvitationAssignableRole
    invitedByUserId: string
    teamId?: string
    membershipType?: MembershipType
  }) =>
    withDb('Failed to create invitation', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(invitations)
          .values({
            organizationId: input.organizationId,
            inviteeUserId: input.inviteeUserId,
            email: input.email,
            role: input.role,
            invitedByUserId: input.invitedByUserId,
            ...(input.teamId ? { teamId: input.teamId } : {}),
            membershipType: input.membershipType ?? 'team',
            token: crypto.randomUUID(),
            expiresAt: sql`now() + interval '7 days'`
          })
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  updateById: (input: {
    id: string
    role?: InvitationAssignableRole
    status?: InvitationStatus
    revokedByUserId?: string
  }) =>
    withDb('Failed to update invitation by id', (db) =>
      Effect.gen(function* () {
        const patch: {
          role?: InvitationAssignableRole
          status?: InvitationStatus
          revokedAt?: ReturnType<typeof sql>
          revokedByUserId?: string
        } = {}

        if (input.role !== undefined) {
          patch.role = input.role
        }

        if (input.status !== undefined) {
          patch.status = input.status

          // When revoking, automatically set audit fields
          if (input.status === 'revoked') {
            patch.revokedAt = sql`now()`
            if (input.revokedByUserId !== undefined) {
              patch.revokedByUserId = input.revokedByUserId
            }
          }
        }

        if (Object.keys(patch).length === 0) {
          // tenant-scope: service-validated
          const rows = yield* db
            .select(invitationSelectColumns)
            .from(invitations)
            .where(eq(invitations.id, input.id))
            .limit(1)
            .execute()

          return yield* decodeFirst(rows, decode)
        }

        // tenant-scope: service-validated
        const rows = yield* db
          .update(invitations)
          .set(patch)
          .where(eq(invitations.id, input.id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  acceptByToken: (token: string, userId: string, email: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const normalizedEmail = normalizeInvitationEmail(email)

        const result = yield* db.transaction((trx) =>
          Effect.gen(function* () {
            // tenant-scope: service-validated
            const updatedRows = yield* trx
              .update(invitations)
              .set({ status: 'accepted', inviteeUserId: userId })
              .where(
                and(
                  eq(invitations.token, token),
                  or(
                    eq(invitations.inviteeUserId, userId),
                    and(
                      isNull(invitations.inviteeUserId),
                      eq(invitations.email, normalizedEmail)
                    )
                  ),
                  eq(invitations.status, 'pending'),
                  gte(invitations.expiresAt, sql`now()`)
                )
              )
              .returning()
              .execute()

            const acceptedOption = yield* decode(updatedRows[0] ?? null)
            if (Option.isNone(acceptedOption)) {
              return Option.none<InvitationRowShape>()
            }

            const accepted = acceptedOption.value
            const orgMembershipType = accepted.teamId ? 'client' : accepted.membershipType

            yield* trx
              .insert(orgMembers)
              .values({
                organizationId: accepted.organizationId,
                userId,
                role: accepted.role,
                membershipType: orgMembershipType
              })
              .onConflictDoUpdate({
                target: [orgMembers.organizationId, orgMembers.userId],
                set: {
                  role: sql`
                    CASE
                      WHEN ${orgMembers.role} = 'admin' OR excluded.role = 'admin' THEN 'admin'::member_role
                      WHEN ${orgMembers.role} = 'member' OR excluded.role = 'member' THEN 'member'::member_role
                      ELSE 'viewer'::member_role
                    END
                  `,
                  membershipType: sql`
                    CASE
                      WHEN ${orgMembers.membershipType} = 'team' OR excluded.membership_type = 'team' THEN 'team'::membership_type
                      ELSE 'client'::membership_type
                    END
                  `,
                  updatedAt: sql`now()`
                }
              })
              .execute()

            if (accepted.membershipType === 'team' && !accepted.teamId) {
              const organizationTeams = yield* trx
                .select({ teamId: teams.id })
                .from(teams)
                .where(eq(teams.organizationId, accepted.organizationId))
                .execute()

              if (organizationTeams.length > 0) {
                yield* trx
                  .insert(teamMembers)
                  .values(organizationTeams.map((team) => ({
                    teamId: team.teamId,
                    userId,
                    role: 'member' as const
                  })))
                  .onConflictDoNothing()
                  .execute()
              }
            }

            if (accepted.teamId) {
              yield* trx
                .insert(teamMembers)
                .values({
                  teamId: accepted.teamId,
                  userId,
                  role: accepted.role
                })
                .onConflictDoUpdate({
                  target: [teamMembers.teamId, teamMembers.userId],
                  set: {
                    role: sql`
                      CASE
                        WHEN ${teamMembers.role} = 'admin' OR excluded.role = 'admin' THEN 'admin'::member_role
                        WHEN ${teamMembers.role} = 'member' OR excluded.role = 'member' THEN 'member'::member_role
                        ELSE 'viewer'::member_role
                      END
                    `,
                    updatedAt: sql`now()`
                  }
                })
                .execute()
            }

            return acceptedOption
          })
        )

        return result
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to accept invitation by token', error))),

  pruneTerminal: (olderThan: Date) =>
    withDb('Failed to prune terminal invitations', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .delete(invitations)
          .where(
            and(
              inArray(invitations.status, ['accepted', 'revoked', 'expired']),
              lt(invitations.createdAt, olderThan)
            )
          )
          .returning({ id: invitations.id })
          .execute()

        return rows.length
      })
    )
}
