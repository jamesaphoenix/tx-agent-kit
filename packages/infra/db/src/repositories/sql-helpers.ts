import { and, sql, type SQL } from 'drizzle-orm'

export const combinePredicates = (predicates: ReadonlyArray<SQL>): SQL => {
  const [first, ...rest] = predicates

  if (!first) {
    return sql`true`
  }

  return rest.reduce<SQL>((acc, predicate) => and(acc, predicate) ?? acc, first)
}
