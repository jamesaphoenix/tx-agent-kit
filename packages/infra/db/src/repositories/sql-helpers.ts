import { and, sql, type SQL } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'
import { dbDecodeFailed, type DbError } from '../errors.js'

export const combinePredicates = (predicates: ReadonlyArray<SQL>): SQL => {
  const [first, ...rest] = predicates

  if (!first) {
    return sql`true`
  }

  return rest.reduce<SQL>((acc, predicate) => and(acc, predicate) ?? acc, first)
}

export const parseCountValue = (value: unknown): number => {
  if (typeof value === 'number') {return value}
  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

export const createNullableDecoder = <A, I>(
  schema: Schema.Schema<A, I>,
  label: string
): ((value: unknown) => Effect.Effect<A | null, DbError>) => {
  const decode = Schema.decodeUnknown(schema)
  return (value: unknown): Effect.Effect<A | null, DbError> => {
    if (value === null || value === undefined) { return Effect.succeed(null) }
    return decode(value).pipe(
      Effect.mapError((error) => dbDecodeFailed(`${label} decode failed`, error))
    )
  }
}

export const createOptionalDecoder = <A, I>(
  schema: Schema.Schema<A, I>,
  label: string
): ((value: unknown) => Effect.Effect<Option.Option<A>, DbError>) => {
  const decode = Schema.decodeUnknown(schema)
  return (value: unknown): Effect.Effect<Option.Option<A>, DbError> => {
    if (value === null || value === undefined) { return Effect.succeed(Option.none()) }
    return decode(value).pipe(
      Effect.map(Option.some),
      Effect.mapError((error) => dbDecodeFailed(`${label} decode failed`, error))
    )
  }
}
