import { decodeCursor, encodeCursor, type CursorPayload } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { buildCursorPage } from './pagination.js'

interface Row {
  readonly id: string
  readonly sortValue: string
}

const makeCursorPayload = (overrides?: Partial<CursorPayload>): CursorPayload => ({
  v: 1,
  sortBy: 'createdAt',
  sortOrder: 'desc',
  sortValue: '2026-02-02T00:00:00.000Z',
  id: 'row-2',
  ...overrides
})

describe('buildCursorPage', () => {
  it('returns data, total, and nextCursor for the first page', async () => {
    const rows: ReadonlyArray<Row> = [
      { id: 'row-1', sortValue: '2026-02-03T00:00:00.000Z' },
      { id: 'row-2', sortValue: '2026-02-02T00:00:00.000Z' },
      { id: 'row-3', sortValue: '2026-02-01T00:00:00.000Z' }
    ]

    const runCount = vi.fn(() => Effect.succeed(3))
    const runPage = vi.fn((cursor: CursorPayload | null, limitPlusOne: number) => {
      expect(cursor).toBeNull()
      expect(limitPlusOne).toBe(3)
      return Effect.succeed(rows)
    })

    const page = await Effect.runPromise(
      buildCursorPage<Row>({
        limit: 2,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        runCount,
        runPage,
        getCursorId: (row) => row.id,
        getCursorSortValue: (row) => row.sortValue
      })
    )

    expect(runCount).toHaveBeenCalledTimes(1)
    expect(runPage).toHaveBeenCalledWith(null, 3)
    expect(page.total).toBe(3)
    expect(page.data).toEqual(rows.slice(0, 2))
    expect(page.prevCursor).toBeNull()
    expect(page.nextCursor).toBeTruthy()
    expect(decodeCursor(page.nextCursor ?? '')).toEqual(makeCursorPayload())
  })

  it('returns prevCursor for follow-up pages and no nextCursor on final page', async () => {
    const incomingCursor = encodeCursor(
      makeCursorPayload({
        sortValue: '2026-02-02T00:00:00.000Z',
        id: 'row-2'
      })
    )

    const runPage = vi.fn((cursor: CursorPayload | null, limitPlusOne: number) => {
      expect(cursor).toEqual(
        makeCursorPayload({
          sortValue: '2026-02-02T00:00:00.000Z',
          id: 'row-2'
        })
      )
      expect(limitPlusOne).toBe(3)
      return Effect.succeed([
        { id: 'row-3', sortValue: '2026-02-01T00:00:00.000Z' }
      ] as const)
    })

    const page = await Effect.runPromise(
      buildCursorPage<Row>({
        cursor: incomingCursor,
        limit: 2,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        runCount: () => Effect.succeed(3),
        runPage,
        getCursorId: (row) => row.id,
        getCursorSortValue: (row) => row.sortValue
      })
    )

    expect(page.data).toEqual([{ id: 'row-3', sortValue: '2026-02-01T00:00:00.000Z' }])
    expect(page.nextCursor).toBeNull()
    expect(page.prevCursor).toBe(incomingCursor)
  })

  it('fails when cursor payload cannot be decoded', async () => {
    const runCount = vi.fn(() => Effect.succeed(0))

    await expect(
      Effect.runPromise(
        buildCursorPage<Row>({
          cursor: 'not-a-valid-cursor',
          limit: 2,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          runCount,
          runPage: () => Effect.succeed([]),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => row.sortValue
        })
      )
    ).rejects.toThrow('Invalid cursor')

    expect(runCount).not.toHaveBeenCalled()
  })

  it('fails when cursor sort metadata does not match requested sort', async () => {
    const mismatchedCursor = encodeCursor(
      makeCursorPayload({
        sortBy: 'title'
      })
    )
    const runCount = vi.fn(() => Effect.succeed(0))

    await expect(
      Effect.runPromise(
        buildCursorPage<Row>({
          cursor: mismatchedCursor,
          limit: 2,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          runCount,
          runPage: () => Effect.succeed([]),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => row.sortValue
        })
      )
    ).rejects.toThrow('Cursor does not match current sort')

    expect(runCount).not.toHaveBeenCalled()
  })
})
