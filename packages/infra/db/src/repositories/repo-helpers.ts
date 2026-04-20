import { Effect, type Option } from 'effect'
import { DB, provideDB, type DbClient } from '../client.js'
import { toDbError, type DbError } from '../errors.js'

type OptionalDecoder<T> = (value: unknown) => Effect.Effect<Option.Option<T>, DbError>

/**
 * Wrap a DB effect with provideDB + standard toDbError mapping.
 * Replaces the `provideDB(Effect.gen(...)).pipe(Effect.mapError(toDbError(...)))` boilerplate.
 *
 * Usage:
 *   getById: (id: string) =>
 *     withDb('Failed to fetch by id', (db) =>
 *       Effect.gen(function* () {
 *         const rows = yield* db.select(cols).from(table).where(eq(table.id, id)).limit(1).execute()
 *         return yield* decoder(rows[0] ?? null)
 *       })
 *     )
 */
export const withDb = <A>(
  errorMessage: string,
  fn: (db: DbClient) => Effect.Effect<A, unknown>
): Effect.Effect<A, DbError> =>
  provideDB(
    Effect.gen(function* () {
      const db = yield* DB
      return yield* fn(db)
    })
  ).pipe(Effect.mapError((error) => toDbError(errorMessage, error)))

/**
 * Decode the first row from a query result as Option<T>.
 * Shorthand for `decoder(rows[0] ?? null)`.
 */
export const decodeFirst = <T>(
  rows: ReadonlyArray<unknown>,
  decoder: OptionalDecoder<T>
): Effect.Effect<Option.Option<T>, DbError> =>
  decoder(rows[0] ?? null)
