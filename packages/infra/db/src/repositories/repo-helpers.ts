import { Effect, Schedule, type Option } from 'effect'
import { DB, provideDB, type DbClient } from '../client.js'
import { isTransientPostgresError, toDbError, type DbError } from '../errors.js'

type OptionalDecoder<T> = (value: unknown) => Effect.Effect<Option.Option<T>, DbError>

// Retry only Postgres transient rollback errors (serialization 40001 / deadlock
// 40P01) — which are guaranteed rolled back, so re-running is safe even for
// writes. Up to 3 retries (4 attempts) with jittered backoff to let contention
// clear; any other error fails immediately (no behaviour change).
const TRANSIENT_DB_RETRY_MAX = 3

const transientDbRetrySchedule = Schedule.recurs(TRANSIENT_DB_RETRY_MAX).pipe(
  Schedule.addDelay(() => '25 millis'),
  Schedule.jittered,
  Schedule.whileInput((error: unknown) => isTransientPostgresError(error))
)

export const retryTransientDbErrors = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => Effect.retry(effect, transientDbRetrySchedule)

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
  )
    .pipe(retryTransientDbErrors)
    .pipe(Effect.mapError((error) => toDbError(errorMessage, error)))

/**
 * Decode the first row from a query result as Option<T>.
 * Shorthand for `decoder(rows[0] ?? null)`.
 */
export const decodeFirst = <T>(
  rows: ReadonlyArray<unknown>,
  decoder: OptionalDecoder<T>
): Effect.Effect<Option.Option<T>, DbError> =>
  decoder(rows[0] ?? null)
