import { describe, expect, it } from 'vitest'
import { CursorCache } from './cursor-cache'

describe('CursorCache', () => {
  it('stores and reads page cursors', () => {
    const cache = new CursorCache()
    const key = 'organizations:default'

    cache.ensureFirstPage(key)
    expect(cache.getCursor(key, 1)).toBeUndefined()

    cache.setCursor(key, 2, 'cursor-2')
    expect(cache.getCursor(key, 2)).toBe('cursor-2')

    cache.setCursor(key, 2, null)
    expect(cache.getCursor(key, 2)).toBeUndefined()
  })

  it('clears scoped and global cache entries', () => {
    const cache = new CursorCache()

    cache.setCursor('a', 2, 'cursor-a')
    cache.setCursor('b', 2, 'cursor-b')

    cache.clearKey('a')
    expect(cache.getCursor('a', 2)).toBeUndefined()
    expect(cache.getCursor('b', 2)).toBe('cursor-b')

    cache.clearAll()
    expect(cache.getCursor('b', 2)).toBeUndefined()
  })
})
