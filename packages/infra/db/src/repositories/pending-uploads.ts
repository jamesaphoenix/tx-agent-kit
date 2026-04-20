import {
  and,
  eq,
  lt
} from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { pendingUploadRowSchema } from '../effect-schemas/pending-uploads.js'
import { dbDecodeFailed } from '../errors.js'
import { pendingUploads } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(pendingUploadRowSchema, 'pending upload row')
const decodeRows = Schema.decodeUnknown(Schema.Array(pendingUploadRowSchema))

export const pendingUploadsRepository = {
  getById: (id: string) =>
    withDb('Failed to fetch pending upload', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.select().from(pendingUploads).where(eq(pendingUploads.id, id)).limit(1).execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  create: (input: {
    teamId: string
    userId: string
    declaredFileSize: number
    contentHash: string | null
    mimeType: string
    storagePath: string
    presignedUrl: string
    expiresAt: Date
  }) =>
    withDb('Failed to create pending upload', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.insert(pendingUploads).values(input).returning().execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  confirm: (id: string) =>
    withDb('Failed to confirm pending upload', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.update(pendingUploads).set({ status: 'confirmed' }).where(and(eq(pendingUploads.id, id), eq(pendingUploads.status, 'pending'))).returning().execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  markExpired: (id: string) =>
    withDb('Failed to mark pending upload expired', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.update(pendingUploads).set({ status: 'expired' }).where(and(eq(pendingUploads.id, id), eq(pendingUploads.status, 'pending'))).returning().execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  markFailed: (id: string) =>
    withDb('Failed to mark pending upload failed', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.update(pendingUploads).set({ status: 'failed' }).where(and(eq(pendingUploads.id, id), eq(pendingUploads.status, 'pending'))).returning().execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  listExpired: (now: Date, limit: number) =>
    withDb('Failed to list expired uploads', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.select().from(pendingUploads).where(and(eq(pendingUploads.status, 'pending'), lt(pendingUploads.expiresAt, now))).limit(limit).execute()
        return yield* decodeRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('expired uploads decode failed', error))
        )
      })
    )
}
