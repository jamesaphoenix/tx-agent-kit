import { describe, expect, it, vi } from 'vitest'
import { withSerializedAuthRefresh } from './auth-token'

describe('withSerializedAuthRefresh', () => {
  it('returns the shared refresh result to concurrent callers', async () => {
    let releaseRefresh!: () => void
    const callback = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseRefresh = resolve
      })
      return 'fresh-token'
    })

    const first = withSerializedAuthRefresh(callback)
    const second = withSerializedAuthRefresh(() => Promise.resolve('stale-token'))

    releaseRefresh()

    await expect(Promise.all([first, second])).resolves.toEqual(['fresh-token', 'fresh-token'])
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
