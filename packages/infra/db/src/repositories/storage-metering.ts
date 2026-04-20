import { eq, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { storageMeteringRowSchema } from '../effect-schemas/storage-metering.js'
import { dbDecodeFailed } from '../errors.js'
import { storageMetering } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(storageMeteringRowSchema, 'storage metering row')

export const storageMeteringRepository = {
  getForOrganization: (organizationId: string) =>
    withDb('Failed to get storage metering for organization', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(storageMetering)
          .where(eq(storageMetering.organizationId, organizationId))
          .limit(1)
          .execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  incrementBytes: (organizationId: string, deltaBytes: number) =>
    withDb('Failed to increment storage metering bytes', (db) =>
      Effect.gen(function* () {
        // @spec INV-AST-011
        yield* db.execute(sql`
          INSERT INTO ${storageMetering} (
            organization_id,
            active_bytes,
            active_asset_count,
            high_water_mark_bytes,
            measured_at
          )
          VALUES (
            ${organizationId},
            ${deltaBytes},
            1,
            ${deltaBytes},
            now()
          )
          ON CONFLICT (organization_id) DO UPDATE SET
            active_bytes = ${storageMetering.activeBytes} + ${deltaBytes},
            active_asset_count = ${storageMetering.activeAssetCount} + 1,
            high_water_mark_bytes = GREATEST(
              ${storageMetering.highWaterMarkBytes},
              ${storageMetering.activeBytes} + ${deltaBytes}
            ),
            measured_at = now()
        `)
      })
    ),

  decrementBytes: (organizationId: string, deltaBytes: number) =>
    withDb('Failed to decrement storage metering bytes', (db) =>
      Effect.gen(function* () {
        yield* db
          .insert(storageMetering)
          .values({
            organizationId,
            activeBytes: 0,
            softDeletedBytes: deltaBytes,
            activeAssetCount: 0,
            softDeletedAssetCount: 1,
            highWaterMarkBytes: 0,
            measuredAt: new Date()
          })
          .onConflictDoUpdate({
            target: storageMetering.organizationId,
            set: {
              // @spec INV-AST-004
              activeBytes: sql`GREATEST(${storageMetering.activeBytes} - ${deltaBytes}, 0)`,
              activeAssetCount: sql`GREATEST(${storageMetering.activeAssetCount} - 1, 0)`,
              softDeletedBytes: sql`${storageMetering.softDeletedBytes} + ${deltaBytes}`,
              softDeletedAssetCount: sql`${storageMetering.softDeletedAssetCount} + 1`,
              measuredAt: new Date()
            }
          })
          .execute()
      })
    ),

  snapshot: (organizationId: string) =>
    withDb('Failed to snapshot storage metering', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(storageMetering)
          .values({
            organizationId,
            activeBytes: 0,
            softDeletedBytes: 0,
            activeAssetCount: 0,
            softDeletedAssetCount: 0,
            highWaterMarkBytes: 0,
            measuredAt: new Date()
          })
          .onConflictDoUpdate({
            target: storageMetering.organizationId,
            set: { measuredAt: new Date() }
          })
          .returning()
          .execute()
        return yield* Schema.decodeUnknown(storageMeteringRowSchema)(rows[0]).pipe(
          Effect.mapError((error) => dbDecodeFailed('storage metering snapshot decode failed', error))
        )
      })
    )
}
