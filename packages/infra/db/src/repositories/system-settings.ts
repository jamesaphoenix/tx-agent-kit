import { eq, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { systemSettingRowSchema } from '../effect-schemas/system-settings.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import type { JsonObject } from '../schema.js'
import { systemSettings } from '../schema.js'

const decodeSystemSettingRow = Schema.decodeUnknown(systemSettingRowSchema)

export interface RetentionTableConfig {
  enabled: boolean
  retention_days: number
}

export type RetentionSettings = Record<string, RetentionTableConfig>

const isRetentionSettings = (value: JsonObject): value is JsonObject & RetentionSettings => {
  if (Object.keys(value).length === 0) return false
  for (const key of Object.keys(value)) {
    const entry = value[key]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return false
    }
    const record = entry as Record<string, unknown>
    if (typeof record.enabled !== 'boolean') {
      return false
    }
    const retentionDays = record.retention_days
    if (typeof retentionDays !== 'number' || !Number.isFinite(retentionDays) || retentionDays <= 0) {
      return false
    }
  }
  return true
}

export const systemSettingsRepository = {
  get: (key: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(systemSettings)
          .where(eq(systemSettings.key, key))
          .limit(1)
          .execute()

        if (!rows[0]) {
          return null
        }

        return yield* decodeSystemSettingRow(rows[0]).pipe(
          Effect.mapError((error) => dbDecodeFailed('system setting row decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get system setting', error))),

  upsert: (key: string, value: JsonObject, description?: string | null) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(systemSettings)
          .values({
            key,
            value,
            description: description ?? null,
            updatedAt: sql`now()`
          })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: {
              value,
              description: description ?? null,
              updatedAt: sql`now()`
            }
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            dbDecodeFailed('system setting upsert returned no row', new Error('empty returning'))
          )
        }

        return yield* decodeSystemSettingRow(row).pipe(
          Effect.mapError((error) => dbDecodeFailed('system setting row decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to upsert system setting', error))),

  getRetentionSettings: () =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(systemSettings)
          .where(eq(systemSettings.key, 'retention_settings'))
          .limit(1)
          .execute()

        if (!rows[0] || !rows[0].value) {
          return {} as RetentionSettings
        }

        const jsonValue = rows[0].value
        if (!isRetentionSettings(jsonValue)) {
          return yield* Effect.fail(
            dbDecodeFailed('retention_settings value failed validation', new Error(JSON.stringify(jsonValue)))
          )
        }

        return jsonValue as RetentionSettings
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get retention settings', error)))
}
