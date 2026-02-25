import { decodeCursor, encodeCursor, type CursorPayload, type SortOrder } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { dbQueryFailed, type DbError } from './errors.js'

export interface CursorPage<T> {
  readonly data: ReadonlyArray<T>
  readonly total: number
  readonly nextCursor: string | null
  readonly prevCursor: string | null
}

export interface BuildCursorPageOptions<T> {
  readonly cursor?: string
  readonly limit: number
  readonly sortBy: string
  readonly sortOrder: SortOrder
  readonly runCount: () => Effect.Effect<number, DbError>
  readonly runPage: (cursor: CursorPayload | null, limitPlusOne: number) => Effect.Effect<ReadonlyArray<T>, DbError>
  readonly getCursorId: (row: T) => string
  readonly getCursorSortValue: (row: T) => string
}

export const buildCursorPage = <T>(options: BuildCursorPageOptions<T>): Effect.Effect<CursorPage<T>, DbError> =>
  Effect.gen(function* () {
    let decodedCursor: CursorPayload | null = null

    if (options.cursor) {
      const parsed = decodeCursor(options.cursor)
      if (!parsed) {
        return yield* Effect.fail(dbQueryFailed('Invalid cursor', new Error('invalid_cursor')))
      }

      if (parsed.sortBy !== options.sortBy || parsed.sortOrder !== options.sortOrder) {
        return yield* Effect.fail(dbQueryFailed('Cursor does not match current sort', new Error('cursor_sort_mismatch')))
      }

      decodedCursor = parsed
    }

    const total = yield* options.runCount()
    const rows = yield* options.runPage(decodedCursor, options.limit + 1)

    const hasNext = rows.length > options.limit
    const data = hasNext ? rows.slice(0, options.limit) : rows
    const last = data[data.length - 1]

    const nextCursor = hasNext && last
      ? encodeCursor({
          v: 1,
          sortBy: options.sortBy,
          sortOrder: options.sortOrder,
          sortValue: options.getCursorSortValue(last),
          id: options.getCursorId(last)
        })
      : null

    return {
      data,
      total,
      nextCursor,
      prevCursor: options.cursor ?? null
    }
  })
