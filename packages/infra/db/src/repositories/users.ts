import { eq, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { userRowSchema, type UserRowShape } from '../effect-schemas/users.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { users } from '../schema.js'

const decodeUserRow = Schema.decodeUnknown(userRowSchema)

const decodeNullableUser = (
  value: unknown
): Effect.Effect<UserRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeUserRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('users row decode failed', error))
  )
}

export const usersRepository = {
  create: (input: { email: string; passwordHash: string; name: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db.insert(users).values(input).returning().execute()
        return yield* decodeNullableUser(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create user', error))),

  findByEmail: (email: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
          .execute()
        const row = rows[0]
        return yield* decodeNullableUser(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find user by email', error))),

  findById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(users)
          .where(eq(users.id, id))
          .limit(1)
          .execute()
        const row = rows[0]
        return yield* decodeNullableUser(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find user by id', error))),

  updatePasswordHash: (id: string, passwordHash: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(users)
          .set({
            passwordHash,
            passwordChangedAt: sql`now()`
          })
          .where(eq(users.id, id))
          .returning()
          .execute()

        return yield* decodeNullableUser(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update user password hash', error))),

  deleteById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db.delete(users).where(eq(users.id, id)).returning().execute()
        return yield* decodeNullableUser(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete user', error)))
}
