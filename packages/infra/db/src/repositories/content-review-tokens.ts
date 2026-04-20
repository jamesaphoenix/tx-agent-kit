import crypto from 'node:crypto'
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  lt,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { buildCursorCondition, buildCursorPage } from '../pagination.js'
import { contentReviewTokenRowSchema, type ContentReviewTokenRow } from '../effect-schemas/content-review-tokens.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { contentReviewTokens } from '../schema.js'
import type { ListParams } from './list-params.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder, parseCountValue } from './sql-helpers.js'

const decodeContentReviewTokenRows = Schema.decodeUnknown(Schema.Array(contentReviewTokenRowSchema))
const decode = createOptionalDecoder(contentReviewTokenRowSchema, 'content review token row')

const selectColumns = {
  id: contentReviewTokens.id,
  teamId: contentReviewTokens.teamId,
  token: contentReviewTokens.token,
  expiresAt: contentReviewTokens.expiresAt,
  revokedAt: contentReviewTokens.revokedAt,
  permissions: contentReviewTokens.permissions,
  reviewerName: contentReviewTokens.reviewerName,
  reviewerEmail: contentReviewTokens.reviewerEmail,
  lastAccessedAt: contentReviewTokens.lastAccessedAt,
  createdBy: contentReviewTokens.createdBy,
  createdAt: contentReviewTokens.createdAt
} as const

export const contentReviewTokensRepository = {
  list: (teamId: string, params: ListParams) =>
    withDb('Failed to list content review tokens', (db) =>
      Effect.gen(function* () {
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere: SQL = eq(contentReviewTokens.teamId, teamId)

        const page = yield* buildCursorPage<ContentReviewTokenRow>({
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
                .from(contentReviewTokens)
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count content review tokens', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              if (sortBy === 'expiresAt') {
                const cursorWhere = buildCursorCondition(cursor, sortOrder, contentReviewTokens.expiresAt, cursor ? new Date(cursor.sortValue) : new Date(), contentReviewTokens.id)

                // tenant-scope: service-validated (baseWhere includes teamId)
                const rows = yield* db
                  .select(selectColumns)
                  .from(contentReviewTokens)
                  .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                  .orderBy(
                    sortOrder === 'asc' ? asc(contentReviewTokens.expiresAt) : desc(contentReviewTokens.expiresAt),
                    sortOrder === 'asc' ? asc(contentReviewTokens.id) : desc(contentReviewTokens.id)
                  )
                  .limit(limitPlusOne)
                  .execute()

                return yield* decodeContentReviewTokenRows(rows).pipe(
                  Effect.mapError((error) => dbDecodeFailed('content review token list decode failed', error))
                )
              }

              const cursorWhere = buildCursorCondition(cursor, sortOrder, contentReviewTokens.createdAt, cursor ? new Date(cursor.sortValue) : new Date(), contentReviewTokens.id)

              // tenant-scope: service-validated (baseWhere includes teamId)
              const rows = yield* db
                .select(selectColumns)
                .from(contentReviewTokens)
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(contentReviewTokens.createdAt) : desc(contentReviewTokens.createdAt),
                  sortOrder === 'asc' ? asc(contentReviewTokens.id) : desc(contentReviewTokens.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeContentReviewTokenRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('content review token list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list content review tokens', error))),
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
    withDb('Failed to fetch content review token by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .select(selectColumns)
          .from(contentReviewTokens)
          .where(eq(contentReviewTokens.id, id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  findByToken: (token: string) =>
    withDb('Failed to find content review token by token', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .select(selectColumns)
          .from(contentReviewTokens)
          .where(eq(contentReviewTokens.token, token))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  create: (input: {
    teamId: string
    expiresAt: Date
    permissions: string[]
    reviewerName?: string | null
    reviewerEmail?: string | null
    createdBy: string
  }) =>
    withDb('Failed to create content review token', (db) =>
      Effect.gen(function* () {
        const token = crypto.randomBytes(32).toString('hex')

        const rows = yield* db
          .insert(contentReviewTokens)
          .values({
            teamId: input.teamId,
            token,
            expiresAt: input.expiresAt,
            permissions: input.permissions,
            reviewerName: input.reviewerName ?? null,
            reviewerEmail: input.reviewerEmail ?? null,
            createdBy: input.createdBy
          })
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  revoke: (id: string) =>
    withDb('Failed to revoke content review token', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(contentReviewTokens)
          .set({ revokedAt: sql`now()` })
          .where(eq(contentReviewTokens.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  touchLastAccessed: (id: string) =>
    withDb('Failed to update last accessed time for content review token', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(contentReviewTokens)
          .set({ lastAccessedAt: sql`now()` })
          .where(eq(contentReviewTokens.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  deleteExpiredAndRevoked: (olderThan: Date) =>
    withDb('Failed to delete expired and revoked content review tokens', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .delete(contentReviewTokens)
          .where(
            and(
              or(
                isNotNull(contentReviewTokens.revokedAt),
                lt(contentReviewTokens.expiresAt, sql`now()`)
              ),
              lt(contentReviewTokens.createdAt, olderThan)
            )
          )
          .returning({ id: contentReviewTokens.id })
          .execute()

        return rows.length
      })
    )
}
