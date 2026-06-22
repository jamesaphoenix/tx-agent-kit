import { eq, inArray, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { userRowSchema } from '../effect-schemas/users.js'
import { users } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(userRowSchema, 'users row')
const decodeMany = Schema.decodeUnknown(Schema.Array(userRowSchema))

export const usersRepository = {
  create: (input: { email: string; passwordHash: string; name: string }) =>
    withDb('Failed to create user', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.insert(users).values(input).returning().execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  findByEmail: (email: string) =>
    withDb('Failed to find user by email', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(users)
          .where(sql`lower(trim(${users.email})) = lower(trim(${email}))`)
          .limit(1)
          .execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  findById: (id: string) =>
    withDb('Failed to find user by id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(users)
          .where(eq(users.id, id))
          .limit(1)
          .execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  /**
   * Batch-read users by id. Used by the lifecycle drip sweep to resolve every
   * claimed enrollment's recipient (email + name) in one query instead of one
   * round-trip per row. Missing ids are simply absent from the result.
   */
  findByIds: (ids: ReadonlyArray<string>) =>
    withDb('Failed to find users by ids', (db) =>
      Effect.gen(function* () {
        if (ids.length === 0) {
          return []
        }
        const rows = yield* db
          .select()
          .from(users)
          .where(inArray(users.id, [...ids]))
          .execute()
        return yield* decodeMany(rows)
      })
    ),

  updatePasswordHash: (id: string, passwordHash: string) =>
    withDb('Failed to update user password hash', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .update(users)
          .set({
            passwordHash,
            passwordChangedAt: sql`now()`
          })
          .where(eq(users.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  deleteById: (id: string) =>
    withDb('Failed to delete user', (db) =>
      Effect.gen(function* () {
        const rows = yield* db.delete(users).where(eq(users.id, id)).returning().execute()
        return yield* decodeFirst(rows, decode)
      })
    )
}
