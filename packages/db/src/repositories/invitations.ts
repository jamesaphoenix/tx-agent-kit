import crypto from 'node:crypto'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  or
} from 'drizzle-orm'
import {
  invitationStatuses,
  workspaceMemberRoles,
  type SortOrder,
  type InvitationAssignableRole,
  type InvitationRole,
  type InvitationStatus
} from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { buildCursorPage } from '../pagination.js'
import { invitationRowSchema, type InvitationRowShape } from '../effect-schemas/invitations.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { invitations, workspaceMembers } from '../schema.js'

interface ListParams {
  readonly cursor?: string
  readonly limit: number
  readonly sortBy: string
  readonly sortOrder: SortOrder
  readonly filter: Readonly<Record<string, string>>
}

const decodeInvitationRows = Schema.decodeUnknown(Schema.Array(invitationRowSchema))
const decodeInvitationRow = Schema.decodeUnknown(invitationRowSchema)

const decodeNullableInvitation = (
  value: unknown
): Effect.Effect<InvitationRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeInvitationRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('invitation row decode failed', error))
  )
}

const parseCountValue = (value: unknown): number => {
  if (typeof value === 'number') {
    return value
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

const isInvitationStatus = (value: string): value is InvitationStatus =>
  invitationStatuses.some((status) => status === value)

const isInvitationRole = (value: string): value is InvitationRole =>
  workspaceMemberRoles.some((role) => role === value)

const buildListWhere = (inviteeUserId: string, params: ListParams) => {
  const predicates = [eq(invitations.inviteeUserId, inviteeUserId)]

  const status = params.filter.status
  if (status && isInvitationStatus(status)) {
    predicates.push(eq(invitations.status, status))
  }

  const role = params.filter.role
  if (role && isInvitationRole(role)) {
    predicates.push(eq(invitations.role, role))
  }

  if (predicates.length === 1) {
    return predicates[0]
  }

  return and(...predicates)
}

export const invitationsRepository = {
  listForInviteeUserId: (inviteeUserId: string, params: ListParams) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere = buildListWhere(inviteeUserId, params)

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
            }).pipe(Effect.mapError((error) => toDbError('Failed to count invitations for invitee', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              if (sortBy === 'expiresAt') {
                const cursorWhere = cursor
                  ? sortOrder === 'asc'
                    ? or(
                        gt(invitations.expiresAt, new Date(cursor.sortValue)),
                        and(eq(invitations.expiresAt, new Date(cursor.sortValue)), gt(invitations.id, cursor.id))
                      )
                    : or(
                        lt(invitations.expiresAt, new Date(cursor.sortValue)),
                        and(eq(invitations.expiresAt, new Date(cursor.sortValue)), lt(invitations.id, cursor.id))
                      )
                  : undefined

                const rows = yield* db
                  .select({
                    id: invitations.id,
                    workspaceId: invitations.workspaceId,
                    inviteeUserId: invitations.inviteeUserId,
                    email: invitations.email,
                    role: invitations.role,
                    status: invitations.status,
                    invitedByUserId: invitations.invitedByUserId,
                    token: invitations.token,
                    expiresAt: invitations.expiresAt,
                    createdAt: invitations.createdAt
                  })
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

              const cursorWhere = cursor
                ? sortOrder === 'asc'
                  ? or(
                      gt(invitations.createdAt, new Date(cursor.sortValue)),
                      and(eq(invitations.createdAt, new Date(cursor.sortValue)), gt(invitations.id, cursor.id))
                    )
                  : or(
                      lt(invitations.createdAt, new Date(cursor.sortValue)),
                      and(eq(invitations.createdAt, new Date(cursor.sortValue)), lt(invitations.id, cursor.id))
                    )
                : undefined

              const rows = yield* db
                .select({
                  id: invitations.id,
                  workspaceId: invitations.workspaceId,
                  inviteeUserId: invitations.inviteeUserId,
                  email: invitations.email,
                  role: invitations.role,
                  status: invitations.status,
                  invitedByUserId: invitations.invitedByUserId,
                  token: invitations.token,
                  expiresAt: invitations.expiresAt,
                  createdAt: invitations.createdAt
                })
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to list invitations for invitee', error))),

  getById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            id: invitations.id,
            workspaceId: invitations.workspaceId,
            inviteeUserId: invitations.inviteeUserId,
            email: invitations.email,
            role: invitations.role,
            status: invitations.status,
            invitedByUserId: invitations.invitedByUserId,
            token: invitations.token,
            expiresAt: invitations.expiresAt,
            createdAt: invitations.createdAt
          })
          .from(invitations)
          .where(eq(invitations.id, id))
          .limit(1)
          .execute()

        return yield* decodeNullableInvitation(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch invitation by id', error))),

  getManyByIds: (ids: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        if (ids.length === 0) {
          return [] as const
        }

        const db = yield* DB
        const rows = yield* db
          .select({
            id: invitations.id,
            workspaceId: invitations.workspaceId,
            inviteeUserId: invitations.inviteeUserId,
            email: invitations.email,
            role: invitations.role,
            status: invitations.status,
            invitedByUserId: invitations.invitedByUserId,
            token: invitations.token,
            expiresAt: invitations.expiresAt,
            createdAt: invitations.createdAt
          })
          .from(invitations)
          .where(inArray(invitations.id, [...ids]))
          .execute()

        return yield* decodeInvitationRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('invitation list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch invitations by ids', error))),

  create: (input: {
    workspaceId: string
    inviteeUserId: string
    email: string
    role: InvitationAssignableRole
    invitedByUserId: string
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(invitations)
          .values({
            ...input,
            token: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
          })
          .returning()
          .execute()

        return yield* decodeNullableInvitation(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create invitation', error))),

  updateById: (input: {
    id: string
    role?: InvitationAssignableRole
    status?: InvitationStatus
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const patch: {
          role?: InvitationAssignableRole
          status?: InvitationStatus
        } = {}

        if (input.role !== undefined) {
          patch.role = input.role
        }

        if (input.status !== undefined) {
          patch.status = input.status
        }

        if (Object.keys(patch).length === 0) {
          const rows = yield* db
            .select({
              id: invitations.id,
              workspaceId: invitations.workspaceId,
              inviteeUserId: invitations.inviteeUserId,
              email: invitations.email,
              role: invitations.role,
              status: invitations.status,
              invitedByUserId: invitations.invitedByUserId,
              token: invitations.token,
              expiresAt: invitations.expiresAt,
              createdAt: invitations.createdAt
            })
            .from(invitations)
            .where(eq(invitations.id, input.id))
            .limit(1)
            .execute()

          return yield* decodeNullableInvitation(rows[0] ?? null)
        }

        const rows = yield* db
          .update(invitations)
          .set(patch)
          .where(eq(invitations.id, input.id))
          .returning()
          .execute()

        return yield* decodeNullableInvitation(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update invitation by id', error))),

  acceptByToken: (token: string, userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const invitationRows = yield* db
          .select()
          .from(invitations)
          .where(
            and(
              eq(invitations.token, token),
              eq(invitations.inviteeUserId, userId),
              eq(invitations.status, 'pending'),
              gte(invitations.expiresAt, new Date())
            )
          )
          .limit(1)
          .execute()
        const invitationRow = invitationRows[0]

        const invitation = yield* decodeNullableInvitation(invitationRow)
        if (!invitation) {
          return null
        }

        yield* db.transaction((trx) =>
          Effect.gen(function* () {
            yield* trx
              .update(invitations)
              .set({ status: 'accepted' })
              .where(eq(invitations.id, invitation.id))
              .execute()

            yield* trx
              .insert(workspaceMembers)
              .values({
                workspaceId: invitation.workspaceId,
                userId,
                role: invitation.role
              })
              .onConflictDoNothing()
              .execute()
          })
        )

        return invitation
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to accept invitation by token', error)))
}
