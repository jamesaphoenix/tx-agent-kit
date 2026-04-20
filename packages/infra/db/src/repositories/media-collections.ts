import type { AssetType } from '@tx-agent-kit/contracts'
import {
  and,
  asc,
  count,
  desc,
  eq,
  type SQL
} from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { buildCursorCondition, buildCursorPage } from '../pagination.js'
import { mediaCollectionRowSchema, type MediaCollectionRowShape } from '../effect-schemas/media-collections.js'
import { teamMediaAssetRowSchema, type TeamMediaAssetRowShape } from '../effect-schemas/team-media-assets.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { mediaCollections, collectionAssets, teamMediaAssets } from '../schema.js'
import type { ListParams } from './list-params.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder, parseCountValue } from './sql-helpers.js'

const decodeCollectionRows = Schema.decodeUnknown(Schema.Array(mediaCollectionRowSchema))
const decodeCollection = createOptionalDecoder(mediaCollectionRowSchema, 'media collection row')
const decodeAssetRows = Schema.decodeUnknown(Schema.Array(teamMediaAssetRowSchema))
const assetTypeFilter = (params: ListParams): SQL | undefined => {
  const assetType = params.filter.assetType as AssetType | undefined
  return assetType ? eq(teamMediaAssets.assetType, assetType) : undefined
}

export const mediaCollectionsRepository = {
  list: (teamId: string, params: ListParams) =>
    withDb('Failed to list media collections', (db) =>
      Effect.gen(function* () {
        const baseWhere: SQL = eq(mediaCollections.teamId, teamId)

        const page = yield* buildCursorPage<MediaCollectionRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db.select({ count: count() }).from(mediaCollections).where(baseWhere).execute()
              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count collections', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              const orderFn = params.sortOrder === 'asc' ? asc : desc
              const cursorWhere = buildCursorCondition(
                cursor,
                params.sortOrder,
                mediaCollections.createdAt,
                cursor ? new Date(cursor.sortValue) : new Date(),
                mediaCollections.id
              )
              const where = cursorWhere ? and(baseWhere, cursorWhere) : baseWhere
              const rows = yield* db
                .select()
                .from(mediaCollections)
                .where(where)
                .orderBy(orderFn(mediaCollections.createdAt), asc(mediaCollections.id))
                .limit(limitPlusOne)
                .execute()
              return yield* decodeCollectionRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('collection rows decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list collections', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => row.createdAt.toISOString()
        })
        return page
      })
    ),

  getById: (id: string) =>
    withDb('Failed to get media collection by id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.select().from(mediaCollections).where(eq(mediaCollections.id, id)).limit(1).execute()
        return yield* decodeFirst(rows, decodeCollection)
      })
    ),

  create: (input: { teamId: string; name: string; description: string | null }) =>
    withDb('Failed to create media collection', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(mediaCollections)
          .values({
            teamId: input.teamId,
            name: input.name,
            description: input.description
          })
          .returning()
          .execute()
        return yield* decodeFirst(rows, decodeCollection)
      })
    ),

  update: (input: { id: string; name?: string; description?: string | null }) =>
    withDb('Failed to update media collection', (db) =>
      Effect.gen(function* () {
        const updates: Record<string, unknown> = { updatedAt: new Date() }
        if (input.name !== undefined) {updates.name = input.name}
        if (input.description !== undefined) {updates.description = input.description}
        const rows = yield* db
          .update(mediaCollections)
          .set(updates)
          .where(eq(mediaCollections.id, input.id))
          .returning()
          .execute()
        return yield* decodeFirst(rows, decodeCollection)
      })
    ),

  remove: (id: string) =>
    withDb('Failed to remove media collection', (db) =>
      Effect.gen(function* () {
        yield* db.delete(mediaCollections).where(eq(mediaCollections.id, id)).execute()
        return { deleted: true as const }
      })
    ),

  addAsset: (collectionId: string, assetId: string) =>
    withDb('Failed to add asset to collection', (db) =>
      Effect.gen(function* () {
        yield* db
          .insert(collectionAssets)
          .values({ collectionId, assetId })
          .onConflictDoNothing()
          .execute()
      })
    ),

  removeAsset: (collectionId: string, assetId: string) =>
    withDb('Failed to remove asset from collection', (db) =>
      Effect.gen(function* () {
        yield* db
          .delete(collectionAssets)
          .where(
            and(
              eq(collectionAssets.collectionId, collectionId),
              eq(collectionAssets.assetId, assetId)
            )
          )
          .execute()
      })
    ),

  listAssets: (collectionId: string, params: ListParams) =>
    withDb('Failed to list collection assets', (db) =>
      Effect.gen(function* () {
        const collectionFilter = eq(collectionAssets.collectionId, collectionId)
        const notDeletedFilter = eq(teamMediaAssets.isDeleted, false)
        const typeFilter = assetTypeFilter(params)
        const baseWhere: SQL = typeFilter
          ? and(collectionFilter, notDeletedFilter, typeFilter) ?? collectionFilter
          : and(collectionFilter, notDeletedFilter) ?? collectionFilter

        const page = yield* buildCursorPage<TeamMediaAssetRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db.select({ count: count() }).from(collectionAssets).innerJoin(teamMediaAssets, eq(collectionAssets.assetId, teamMediaAssets.id)).where(baseWhere).execute()
              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count collection assets', error))),
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
                .select({
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
                })
                .from(collectionAssets)
                .innerJoin(teamMediaAssets, eq(collectionAssets.assetId, teamMediaAssets.id))
                .where(where)
                .orderBy(orderFn(teamMediaAssets.createdAt), asc(teamMediaAssets.id))
                .limit(limitPlusOne)
                .execute()
              return yield* decodeAssetRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('collection asset rows decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list collection assets', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => row.createdAt.toISOString()
        })
        return page
      })
    )
}
