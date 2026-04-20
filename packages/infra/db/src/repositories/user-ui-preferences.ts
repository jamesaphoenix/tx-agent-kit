import { and, eq, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { userUiPreferenceRowSchema } from '../effect-schemas/user-ui-preferences.js'
import { dbDecodeFailed } from '../errors.js'
import { userUiPreferences } from '../schema.js'
import { withDb } from './repo-helpers.js'

const billingNoCapReminderPreferenceKey = 'billing.no_cap_reminder'
const decodeUserUiPreferenceRow = Schema.decodeUnknown(userUiPreferenceRowSchema)

export const userUiPreferencesRepository = {
  isBillingNoCapReminderDismissed: (input: {
    userId: string
    organizationId: string
  }) =>
    withDb('Failed to fetch billing no-cap reminder preference', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(userUiPreferences)
          .where(and(
            eq(userUiPreferences.userId, input.userId),
            eq(userUiPreferences.organizationId, input.organizationId),
            eq(userUiPreferences.preferenceKey, billingNoCapReminderPreferenceKey)
          ))
          .limit(1)
          .execute()

        const row = rows[0]
        if (!row) {
          return false
        }

        yield* decodeUserUiPreferenceRow(row).pipe(
          Effect.mapError((error) => dbDecodeFailed('user UI preference row decode failed', error))
        )
        return true
      })
    ),

  dismissBillingNoCapReminder: (input: {
    userId: string
    organizationId: string
  }) =>
    withDb('Failed to dismiss billing no-cap reminder', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .insert(userUiPreferences)
          .values({
            userId: input.userId,
            organizationId: input.organizationId,
            preferenceKey: billingNoCapReminderPreferenceKey
          })
          .onConflictDoUpdate({
            target: [
              userUiPreferences.userId,
              userUiPreferences.organizationId,
              userUiPreferences.preferenceKey
            ],
            set: {
              dismissedAt: sql`now()`
            }
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            dbDecodeFailed('user UI preference upsert returned no row', new Error('empty returning'))
          )
        }

        yield* decodeUserUiPreferenceRow(row).pipe(
          Effect.mapError((error) => dbDecodeFailed('user UI preference row decode failed', error))
        )
      })
    )
}
