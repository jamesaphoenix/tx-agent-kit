import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMIT, MAX_LIMIT } from '@tx-agent-kit/core'
import { parseListQuery } from './list-query.js'

const defaultOptions = {
  defaultSortBy: 'createdAt',
  allowedSortBy: ['createdAt', 'title'],
  allowedFilterKeys: ['status', 'createdByUserId']
} as const

describe('parseListQuery', () => {
  it('applies default values and keeps empty filters out', () => {
    const parsed = parseListQuery(
      {
        'filter[status]': '',
        'filter[createdByUserId]': undefined
      },
      defaultOptions
    )

    expect(parsed).toEqual({
      ok: true,
      value: {
        cursor: undefined,
        limit: DEFAULT_LIMIT,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        filter: {}
      }
    })
  })

  it('normalizes sort/filter values and clamps excessive limit', () => {
    const parsed = parseListQuery(
      {
        limit: String(MAX_LIMIT + 50),
        sortBy: 'title',
        sortOrder: 'asc',
        cursor: 'cursor-token',
        'filter[status]': 'done'
      },
      defaultOptions
    )

    expect(parsed).toEqual({
      ok: true,
      value: {
        cursor: 'cursor-token',
        limit: MAX_LIMIT,
        sortBy: 'title',
        sortOrder: 'asc',
        filter: {
          status: 'done'
        }
      }
    })
  })

  it('rejects invalid sortBy values', () => {
    const parsed = parseListQuery(
      {
        sortBy: 'unknown'
      },
      defaultOptions
    )

    expect(parsed).toEqual({
      ok: false,
      message: 'Invalid sortBy parameter. Allowed values: createdAt, title'
    })
  })

  it('rejects unknown filter keys', () => {
    const parsed = parseListQuery(
      {
        'filter[role]': 'admin'
      },
      defaultOptions
    )

    expect(parsed).toEqual({
      ok: false,
      message: 'Invalid filter key: role'
    })
  })
})
