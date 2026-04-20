import { Option } from 'effect'
import type { PaginatedResult } from '../pagination.js'

export const toRecord = <
  Row extends Record<string, unknown>,
  const Keys extends readonly (keyof Row)[]
>(
  keys: Keys
) =>
  (row: Row): Pick<Row, Keys[number]> => {
    const entries = keys.map((key) => [key, row[key]] as const)
    return Object.fromEntries(entries) as Pick<Row, Keys[number]>
  }

export const mapPaginatedResult = <Input, Output>(
  page: PaginatedResult<Input>,
  mapItem: (item: Input) => Output
): PaginatedResult<Output> => ({
  data: page.data.map(mapItem),
  total: page.total,
  nextCursor: page.nextCursor,
  prevCursor: page.prevCursor
})

export const mapNullable = <Input, Output>(
  value: Input | null,
  mapItem: (item: Input) => Output
): Output | null => (value === null ? null : mapItem(value))

export const mapOptional = <Input, Output>(
  value: Option.Option<Input>,
  mapItem: (item: Input) => Output
): Option.Option<Output> => Option.map(value, mapItem)
