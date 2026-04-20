import { eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { userRowSchema } from '../effect-schemas/users.js'
import { users } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(userRowSchema, 'users row')

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
