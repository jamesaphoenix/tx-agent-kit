import { describe, expect, it } from 'vitest'
import { mapCoreError } from '../api.js'

describe('api error mapping', () => {
  it('maps core unauthorized to api unauthorized', () => {
    const error = mapCoreError({ _tag: 'CoreError', code: 'UNAUTHORIZED', message: 'nope' })
    expect(error._tag).toBe('Unauthorized')
  })
})
