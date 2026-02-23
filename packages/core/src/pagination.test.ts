import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIMIT,
  DEFAULT_SORT_ORDER,
  MAX_LIMIT,
  type ListParams
} from './pagination.js'

describe('pagination defaults', () => {
  it('exposes stable default constants', () => {
    expect(DEFAULT_LIMIT).toBe(25)
    expect(MAX_LIMIT).toBe(100)
    expect(DEFAULT_SORT_ORDER).toBe('desc')
    expect(DEFAULT_LIMIT).toBeLessThan(MAX_LIMIT)
  })

  it('supports constructing list params with defaults', () => {
    const params: ListParams = {
      limit: DEFAULT_LIMIT,
      sortBy: 'createdAt',
      sortOrder: DEFAULT_SORT_ORDER,
      filter: {}
    }

    expect(params.cursor).toBeUndefined()
    expect(params.limit).toBe(DEFAULT_LIMIT)
    expect(params.sortOrder).toBe('desc')
    expect(params.filter).toEqual({})
  })
})
