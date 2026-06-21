import * as PgClient from '@effect/sql-pg/PgClient'
import * as PgDrizzle from 'drizzle-orm/effect-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Context, Effect, Layer, ManagedRuntime, Redacted } from 'effect'
import type { ConnectionOptions } from 'node:tls'
import { Pool } from 'pg'
import { types } from 'pg'
import { getDbEnv } from './env.js'
import * as schema from './schema.js'

let poolSingleton: Pool | undefined
const dbRuntimeSingletons = new Map<string, ManagedRuntime.ManagedRuntime<DB, unknown>>()
const rawTimestampTypeIds = [1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182]

type PoolErrorReporter = (error: unknown) => void
let poolErrorReporter: PoolErrorReporter = () => {}

/**
 * Register a handler for raw `pg.Pool` `'error'` events (idle client failures
 * when the backend/pooler drops a connection). Backend processes inject their
 * Sentry capture at boot (e.g. `setPoolErrorReporter(captureWorkerException)`),
 * so these transient errors are reported instead of silently swallowed.
 *
 * Kept as an injected hook so this package stays free of any Sentry/logging
 * dependency. The default no-op still guarantees the no-crash invariant even
 * when no reporter is wired (scripts, tests, API before init).
 */
export const setPoolErrorReporter = (reporter: PoolErrorReporter): void => {
  poolErrorReporter = reporter
}

const getDatabaseUrl = (): string => {
  const env = getDbEnv()
  return env.DATABASE_URL
}

export const getPgSslConfigForDatabaseUrl = (
  databaseUrl: string
): boolean | ConnectionOptions | undefined => {
  const parsedUrl = new URL(databaseUrl)
  const sslMode = parsedUrl.searchParams.get('sslmode')?.toLowerCase()

  if (sslMode === 'disable') {
    return false
  }

  if (sslMode === 'require' || sslMode === 'prefer') {
    return { rejectUnauthorized: false }
  }

  return undefined
}

export const normalizeDatabaseUrlForPgDriver = (databaseUrl: string): string => {
  const parsedUrl = new URL(databaseUrl)
  const sslMode = parsedUrl.searchParams.get('sslmode')?.toLowerCase()

  if (
    (sslMode === 'require' || sslMode === 'prefer') &&
    !parsedUrl.searchParams.has('uselibpqcompat')
  ) {
    parsedUrl.searchParams.set('uselibpqcompat', 'true')
  }

  return parsedUrl.toString()
}

export const getPool = (): Pool => {
  if (!poolSingleton) {
    const databaseUrl = getDatabaseUrl()
    const connectionString = normalizeDatabaseUrlForPgDriver(databaseUrl)
    poolSingleton = new Pool({
      connectionString,
      ssl: getPgSslConfigForDatabaseUrl(databaseUrl),
      max: getDbEnv().DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5000
    })
    // node-postgres emits pool errors for idle clients. Without a listener, Node
    // treats that EventEmitter error as uncaught and terminates the worker. We
    // consume it here (no crash) AND forward to the injected reporter so it is
    // still sent to Sentry rather than silently swallowed.
    poolSingleton.on('error', (error) => {
      poolErrorReporter(error)
    })
  }
  return poolSingleton
}

export const resetPool = async (): Promise<void> => {
  await disposeDBRuntimes()

  if (!poolSingleton) {
    return
  }

  const activePool = poolSingleton
  poolSingleton = undefined
  await activePool.end()
}

export const db = drizzle({ client: getPool(), schema })

const makePgClientLive = (databaseUrl?: string) =>
  PgClient.layer({
    url: Redacted.make(normalizeDatabaseUrlForPgDriver(databaseUrl ?? getDatabaseUrl())),
    ssl: getPgSslConfigForDatabaseUrl(databaseUrl ?? getDatabaseUrl()),
    // Without maxConnections the underlying node-postgres pg.Pool silently caps
    // its max at 10, so every Effect repository request serializes behind only 10
    // connections regardless of DB_POOL_MAX. Size it from the configured pool max.
    maxConnections: getDbEnv().DB_POOL_MAX,
    types: {
      getTypeParser: (typeId, format) => {
        if (rawTimestampTypeIds.includes(typeId)) {
          return (value: unknown) => value
        }

        const parser = types.getTypeParser(typeId, format) as (value: string) => unknown
        return (value: unknown) => {
          if (typeof value !== 'string') {
            return value
          }
          return parser(value)
        }
      }
    }
  })

const makeDb = Effect.gen(function* () {
  yield* PgClient.PgClient
  return yield* PgDrizzle.makeWithDefaults({ schema })
})

export type DbClient = Effect.Effect.Success<typeof makeDb>
export class DB extends Context.Tag('@tx-agent-kit/db/DB')<DB, DbClient>() {}

export const DBLive = Layer.scoped(DB, makeDb)
const makeDBRuntimeLive = (databaseUrl?: string) => Layer.provide(DBLive, makePgClientLive(databaseUrl))

const getDBRuntime = (databaseUrl?: string): ManagedRuntime.ManagedRuntime<DB, unknown> => {
  const resolvedDatabaseUrl = databaseUrl ?? getDatabaseUrl()
  const existingRuntime = dbRuntimeSingletons.get(resolvedDatabaseUrl)
  if (existingRuntime) {
    return existingRuntime
  }

  const runtime = ManagedRuntime.make(makeDBRuntimeLive(resolvedDatabaseUrl))
  dbRuntimeSingletons.set(resolvedDatabaseUrl, runtime)
  return runtime
}

const disposeDBRuntimes = async (): Promise<void> => {
  if (dbRuntimeSingletons.size === 0) {
    return
  }

  const runtimes = Array.from(dbRuntimeSingletons.values())
  dbRuntimeSingletons.clear()
  await Promise.all(runtimes.map((runtime) => runtime.dispose()))
}

export const dbClientEffect: Effect.Effect<DbClient, unknown> = Effect.suspend(() =>
  Effect.gen(function* () {
    return yield* DB
  }).pipe(Effect.provide(getDBRuntime()))
)

export const provideDB = <A, E, R>(
  effect: Effect.Effect<A, E, R | DB>
): Effect.Effect<A, E, Exclude<R, DB>> =>
  Effect.suspend(() =>
    effect.pipe(Effect.provide(getDBRuntime()))
  ) as Effect.Effect<A, E, Exclude<R, DB>>

export const provideDBWithUrl = <A, E, R>(
  effect: Effect.Effect<A, E, R | DB>,
  databaseUrl: string
): Effect.Effect<A, E, Exclude<R, DB>> =>
  Effect.suspend(() =>
    effect.pipe(Effect.provide(getDBRuntime(databaseUrl)))
  ) as Effect.Effect<A, E, Exclude<R, DB>>
