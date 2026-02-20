import { describe, expect, it } from 'vitest'
import { createLogger } from './index.js'

describe('createLogger', () => {
  it('creates child logger with scoped service name', () => {
    const root = createLogger('test-service')
    const child = root.child('openapi')

    expect(child).toBeDefined()
    expect(typeof child.info).toBe('function')
  })
})
