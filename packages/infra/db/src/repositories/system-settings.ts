import { eq, sql } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'
import { systemSettingRowSchema } from '../effect-schemas/system-settings.js'
import { dbDecodeFailed } from '../errors.js'
import type { JsonObject } from '../schema.js'
import { systemSettings } from '../schema.js'
import { withDb } from './repo-helpers.js'

const decodeSystemSettingRow = Schema.decodeUnknown(systemSettingRowSchema)

export interface RetentionTableConfig {
  enabled: boolean
  retention_days: number
}

export type RetentionSettings = Record<string, RetentionTableConfig>

const isRetentionSettings = (value: JsonObject): value is JsonObject & RetentionSettings => {
  if (Object.keys(value).length === 0) {return false}
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
    withDb('Failed to get system setting', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(systemSettings)
          .where(eq(systemSettings.key, key))
          .limit(1)
          .execute()

        if (!rows[0]) {
          return Option.none()
        }

        return yield* decodeSystemSettingRow(rows[0]).pipe(
          Effect.map(Option.some),
          Effect.mapError((error) => dbDecodeFailed('system setting row decode failed', error))
        )
      })
    ),

  upsert: (key: string, value: JsonObject, description?: string | null) =>
    withDb('Failed to upsert system setting', (db) =>
      Effect.gen(function* () {
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
    ),

  getRetentionSettings: () =>
    withDb('Failed to get retention settings', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(systemSettings)
          .where(eq(systemSettings.key, 'retention_settings'))
          .limit(1)
          .execute()

        if (!rows[0]?.value) {
          return {}
        }

        const jsonValue = rows[0].value
        if (!isRetentionSettings(jsonValue)) {
          return yield* Effect.fail(
            dbDecodeFailed('retention_settings value failed validation', new Error(JSON.stringify(jsonValue)))
          )
        }

        return jsonValue
      })
    )
}
