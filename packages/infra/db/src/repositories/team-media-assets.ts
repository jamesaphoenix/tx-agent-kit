import type { AssetType, ProcessingStatus } from '@tx-agent-kit/contracts'
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { buildCursorCondition, buildCursorPage } from '../pagination.js'
import { teamMediaAssetRowSchema, type TeamMediaAssetRowShape } from '../effect-schemas/team-media-assets.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { teamMediaAssets, teams } from '../schema.js'
import { insertDomainEventInTransaction, type InsertDomainEventInput } from './domain-events.js'
import type { ListParams } from './list-params.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder, parseCountValue } from './sql-helpers.js'

const decodeAssetRows = Schema.decodeUnknown(Schema.Array(teamMediaAssetRowSchema))
const decode = createOptionalDecoder(teamMediaAssetRowSchema, 'team media asset row')
const escapeLikePattern = (value: string): string => value.replaceAll(/[\\%_]/g, '\\$&')
const assetTypeFilter = (params: ListParams): SQL | undefined => {
  const assetType = params.filter.assetType as AssetType | undefined
  return assetType ? eq(teamMediaAssets.assetType, assetType) : undefined
}

const orgAssetSelectColumns = {
  id: teamMediaAssets.id,
  teamId: teamMediaAssets.teamId,
  originalFilename: teamMediaAssets.originalFilename,
  fileSize: teamMediaAssets.fileSize,
  mimeType: teamMediaAssets.mimeType,
  assetType: teamMediaAssets.assetType,
  assetCategory: teamMediaAssets.assetCategory,
  assetTypeData: teamMediaAssets.assetTypeData,
  storagePath: teamMediaAssets.storagePath,
  thumbnailPath: teamMediaAssets.thumbnailPath,
  aiTitle: teamMediaAssets.aiTitle,
  aiDescription: teamMediaAssets.aiDescription,
  aiTags: teamMediaAssets.aiTags,
  contentCategory: teamMediaAssets.contentCategory,
  emotion: teamMediaAssets.emotion,
  purpose: teamMediaAssets.purpose,
  contentHash: teamMediaAssets.contentHash,
  processingStatus: teamMediaAssets.processingStatus,
  processingError: teamMediaAssets.processingError,
  embeddingGeneratedAt: teamMediaAssets.embeddingGeneratedAt,
  embeddingModel: teamMediaAssets.embeddingModel,
  isDeleted: teamMediaAssets.isDeleted,
  deletedAt: teamMediaAssets.deletedAt,
  hardDeletedAt: teamMediaAssets.hardDeletedAt,
  sharedWithOrg: teamMediaAssets.sharedWithOrg,
  createdAt: teamMediaAssets.createdAt,
  updatedAt: teamMediaAssets.updatedAt
} as const

const listOrganizationAssets = (
  organizationId: string,
  params: ListParams,
  includeDeleted: boolean
) =>
  withDb('Failed to list team media assets by organization', (db) =>
    Effect.gen(function* () {
      const orgFilter = eq(teams.organizationId, organizationId)
      const filters: SQL[] = includeDeleted
        ? [orgFilter]
        : [orgFilter, eq(teamMediaAssets.isDeleted, false)]
      const typeFilter = assetTypeFilter(params)
      if (typeFilter) {
        filters.push(typeFilter)
      }
      const baseWhere: SQL = and(...filters) ?? orgFilter

      const page = yield* buildCursorPage<TeamMediaAssetRowShape>({
        cursor: params.cursor,
        limit: params.limit,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        runCount: () =>
          Effect.gen(function* () {
            const rows = yield* db
              .select({ count: count() })
              .from(teamMediaAssets)
              .innerJoin(teams, eq(teamMediaAssets.teamId, teams.id))
              .where(baseWhere)
              .execute()
            return parseCountValue(rows[0]?.count)
          }).pipe(Effect.mapError((error) => toDbError('Failed to count org assets', error))),
        runPage: (cursor, limitPlusOne) =>
          Effect.gen(function* () {
            const orderFn = params.sortOrder === 'asc' ? asc : desc
            const cursorWhere = buildCursorCondition(
              cursor,
              params.sortOrder,
              teamMediaAssets.createdAt,
              cursor ? new Date(cursor.sortValue) : new Date(),
              teamMediaAssets.id
            )
            const where = cursorWhere ? and(baseWhere, cursorWhere) : baseWhere
            const rows = yield* db
              .select(orgAssetSelectColumns)
              .from(teamMediaAssets)
              .innerJoin(teams, eq(teamMediaAssets.teamId, teams.id))
              .where(where)
              .orderBy(orderFn(teamMediaAssets.createdAt), asc(teamMediaAssets.id))
              .limit(limitPlusOne)
              .execute()
            return yield* decodeAssetRows(rows).pipe(
              Effect.mapError((error) => dbDecodeFailed('org asset rows decode failed', error))
            )
          }).pipe(Effect.mapError((error) => toDbError('Failed to list org assets', error))),
        getCursorId: (row) => row.id,
        getCursorSortValue: (row) => row.createdAt.toISOString()
      })

      return page
    })
  )

export const teamMediaAssetsRepository = {
  list: (teamId: string, params: ListParams) =>
    withDb('Failed to list team media assets', (db) =>
      Effect.gen(function* () {
        const teamFilter = eq(teamMediaAssets.teamId, teamId)
        const notDeletedFilter = eq(teamMediaAssets.isDeleted, false)
        const typeFilter = assetTypeFilter(params)
        const baseWhere: SQL = typeFilter
          ? and(teamFilter, notDeletedFilter, typeFilter) ?? teamFilter
          : and(teamFilter, notDeletedFilter) ?? teamFilter

        const page = yield* buildCursorPage<TeamMediaAssetRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db.select({ count: count() }).from(teamMediaAssets).where(baseWhere).execute()
              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count assets', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              const orderFn = params.sortOrder === 'asc' ? asc : desc
              const cursorWhere = buildCursorCondition(
                cursor,
                params.sortOrder,
                teamMediaAssets.createdAt,
                cursor ? new Date(cursor.sortValue) : new Date(),
                teamMediaAssets.id
              )
              const where = cursorWhere ? and(baseWhere, cursorWhere) : baseWhere
              const rows = yield* db
                .select()
                .from(teamMediaAssets)
                .where(where)
                .orderBy(orderFn(teamMediaAssets.createdAt), asc(teamMediaAssets.id))
                .limit(limitPlusOne)
                .execute()
              return yield* decodeAssetRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('asset rows decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list assets', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => row.createdAt.toISOString()
        })

        return page
      })
    ),

  search: (teamId: string, query: string, params: ListParams) =>
    withDb('Failed to search team media assets', (db) =>
      Effect.gen(function* () {
        const pattern = `%${escapeLikePattern(query.trim())}%`
        const teamFilter = eq(teamMediaAssets.teamId, teamId)
        const notDeletedFilter = eq(teamMediaAssets.isDeleted, false)
        const typeFilter = assetTypeFilter(params)
        const searchFilter = or(
          sql`${teamMediaAssets.originalFilename} ILIKE ${pattern} ESCAPE '\\'`,
          sql`${teamMediaAssets.aiTitle} ILIKE ${pattern} ESCAPE '\\'`,
          sql`${teamMediaAssets.aiDescription} ILIKE ${pattern} ESCAPE '\\'`,
          sql`EXISTS (
            SELECT 1
              FROM unnest(${teamMediaAssets.aiTags}) AS tag
             WHERE tag ILIKE ${pattern} ESCAPE '\\'
          )`
        ) ?? sql`false`
        const baseWhere: SQL = typeFilter
          ? and(teamFilter, notDeletedFilter, typeFilter, searchFilter) ?? teamFilter
          : and(teamFilter, notDeletedFilter, searchFilter) ?? teamFilter

        const page = yield* buildCursorPage<TeamMediaAssetRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db.select({ count: count() }).from(teamMediaAssets).where(baseWhere).execute()
              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count searched assets', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              const orderFn = params.sortOrder === 'asc' ? asc : desc
              const cursorWhere = buildCursorCondition(
                cursor,
                params.sortOrder,
                teamMediaAssets.createdAt,
                cursor ? new Date(cursor.sortValue) : new Date(),
                teamMediaAssets.id
              )
              const where = cursorWhere ? and(baseWhere, cursorWhere) : baseWhere
              const rows = yield* db
                .select()
                .from(teamMediaAssets)
                .where(where)
                .orderBy(orderFn(teamMediaAssets.createdAt), asc(teamMediaAssets.id))
                .limit(limitPlusOne)
                .execute()
              return yield* decodeAssetRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('asset search rows decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to search assets', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => row.createdAt.toISOString()
        })

        return page
      })
    ),

  getById: (id: string) =>
    withDb('Failed to get team media asset by id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(teamMediaAssets)
          .where(and(eq(teamMediaAssets.id, id), eq(teamMediaAssets.isDeleted, false)))
          .limit(1)
          .execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  // Internal: returns asset regardless of soft-delete state (used by retention cleaner, markHardDeleted)
  getByIdIncludeDeleted: (id: string) =>
    withDb('Failed to get team media asset by id (include deleted)', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.select().from(teamMediaAssets).where(eq(teamMediaAssets.id, id)).limit(1).execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  getManyByIds: (ids: ReadonlyArray<string>) =>
    withDb('Failed to get many team media assets by ids', (db) =>
      Effect.gen(function* () {
        if (ids.length === 0) {return []}
        const rows = yield* db.select().from(teamMediaAssets).where(inArray(teamMediaAssets.id, [...ids])).execute()
        return yield* decodeAssetRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('asset rows decode failed', error))
        )
      })
    ),

  findByContentHash: (teamId: string, contentHash: string) =>
    withDb('Failed to find team media asset by content hash', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(teamMediaAssets)
          .where(
            and(
              eq(teamMediaAssets.teamId, teamId),
              eq(teamMediaAssets.contentHash, contentHash),
              eq(teamMediaAssets.isDeleted, false)
            )
          )
          .limit(1)
          .execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  create: (input: {
    id?: string
    teamId: string
    originalFilename: string
    fileSize: number
    mimeType: string
    assetType: string
    storagePath: string
    thumbnailPath: string | null
    contentHash: string | null
    processingStatus?: ProcessingStatus
    outboxEvent?: InsertDomainEventInput
  }) =>
    withDb('Failed to create team media asset', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.transaction((trx) =>
          Effect.gen(function* () {
            const values: typeof teamMediaAssets.$inferInsert = {
              teamId: input.teamId,
              originalFilename: input.originalFilename,
              fileSize: input.fileSize,
              mimeType: input.mimeType,
              assetType: input.assetType as AssetType,
              storagePath: input.storagePath,
              thumbnailPath: input.thumbnailPath,
              contentHash: input.contentHash,
              processingStatus: input.processingStatus ?? 'pending'
            }
            if (input.id !== undefined) {
              values.id = input.id
            }

            const inserted = yield* trx
              .insert(teamMediaAssets)
              .values(values)
              .returning()
              .execute()

            if (input.outboxEvent) {
              yield* insertDomainEventInTransaction(trx, input.outboxEvent)
            }

            return inserted
          })
        )
        return yield* decodeFirst(rows, decode)
      })
    ),

  update: (input: {
    id: string
    thumbnailPath?: string | null
    aiTitle?: string | null
    aiDescription?: string | null
    aiTags?: ReadonlyArray<string>
    processingStatus?: string
    processingError?: string | null
    sharedWithOrg?: boolean
  }) =>
    withDb('Failed to update team media asset', (db) =>
      Effect.gen(function* () {
        const updates: Record<string, unknown> = { updatedAt: new Date() }
        if (input.thumbnailPath !== undefined) {updates.thumbnailPath = input.thumbnailPath}
        if (input.aiTitle !== undefined) {updates.aiTitle = input.aiTitle}
        if (input.aiDescription !== undefined) {updates.aiDescription = input.aiDescription}
        if (input.aiTags !== undefined) {updates.aiTags = [...input.aiTags]}
        if (input.processingStatus !== undefined) {updates.processingStatus = input.processingStatus}
        if (input.processingError !== undefined) {updates.processingError = input.processingError}
        if (input.sharedWithOrg !== undefined) {updates.sharedWithOrg = input.sharedWithOrg}

        const rows = yield* db
          .update(teamMediaAssets)
          .set(updates)
          .where(eq(teamMediaAssets.id, input.id))
          .returning()
          .execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  softDelete: (id: string) =>
    withDb('Failed to soft delete team media asset', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(teamMediaAssets)
          .set({ isDeleted: true, deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(teamMediaAssets.id, id))
          .returning()
          .execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  hardDelete: (id: string) =>
    withDb('Failed to hard delete team media asset', (db) =>
      Effect.gen(function* () {
        yield* db.delete(teamMediaAssets).where(eq(teamMediaAssets.id, id)).execute()
        return { deleted: true as const }
      })
    ),

  markHardDeleted: (id: string) =>
    withDb('Failed to mark team media asset as hard deleted', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(teamMediaAssets)
          .set({ hardDeletedAt: new Date(), updatedAt: new Date() })
          .where(eq(teamMediaAssets.id, id))
          .returning()
          .execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  listSoftDeletedForRetention: (input: { olderThan: Date; limit: number }) =>
    withDb('Failed to list soft deleted assets for retention', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(teamMediaAssets)
          .where(
            and(
              eq(teamMediaAssets.isDeleted, true),
              isNull(teamMediaAssets.hardDeletedAt),
              lt(teamMediaAssets.deletedAt, input.olderThan)
            )
          )
          .limit(input.limit)
          .execute()
        return yield* decodeAssetRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('retention candidates decode failed', error))
        )
      })
    ),

  listByOrganization: (organizationId: string, params: ListParams) =>
    listOrganizationAssets(organizationId, params, false),

  listByOrganizationIncludingDeleted: (organizationId: string, params: ListParams) =>
    // @spec INV-AST-009
    listOrganizationAssets(organizationId, params, true)
}
