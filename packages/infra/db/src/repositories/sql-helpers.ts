import { and, sql, type SQL } from 'drizzle-orm'

export const combinePredicates = (predicates: ReadonlyArray<SQL<unknown>>): SQL<unknown> => {
  const [first, ...rest] = predicates

  if (!first) {
    return sql`true`
  }

  return rest.reduce<SQL<unknown>>((acc, predicate) => and(acc, predicate) ?? acc, first)
}
