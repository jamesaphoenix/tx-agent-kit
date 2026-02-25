import * as PgClient from '@effect/sql-pg/PgClient'
import * as PgDrizzle from 'drizzle-orm/effect-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Context, Effect, Layer, Redacted } from 'effect'
import { Pool } from 'pg'
import { types } from 'pg'
import { getDbEnv } from './env.js'
import * as schema from './schema.js'

let poolSingleton: Pool | undefined
const rawTimestampTypeIds = [1184, 1114, 1082, 1186, 1231, 1115, 1185, 1187, 1182]

const getDatabaseUrl = (): string => {
  const env = getDbEnv()
  return env.DATABASE_URL
}

export const getPool = (): Pool => {
  if (!poolSingleton) {
    const connectionString = getDatabaseUrl()
    poolSingleton = new Pool({ connectionString })
  }
  return poolSingleton
}

export const db = drizzle({ client: getPool(), schema })

const PgClientLive = PgClient.layer({
  url: Redacted.make(getDatabaseUrl()),
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
  const client = yield* PgClient.PgClient
  return PgDrizzle.drizzle(client, { schema })
})

export type DbClient = Effect.Effect.Success<typeof makeDb>
export class DB extends Context.Tag('@tx-agent-kit/db/DB')<DB, DbClient>() {}

export const DBLive = Layer.scoped(DB, makeDb)
const DBRuntimeLive = Layer.provide(DBLive, PgClientLive)

export const dbClientEffect: Effect.Effect<DbClient, unknown, never> = Effect.gen(function* () {
  return yield* DB
}).pipe(Effect.provide(DBRuntimeLive))

export const provideDB = <A, E, R>(
  effect: Effect.Effect<A, E, R | DB>
): Effect.Effect<A, E, Exclude<R, DB>> =>
  effect.pipe(Effect.provide(DBRuntimeLive)) as Effect.Effect<A, E, Exclude<R, DB>>
