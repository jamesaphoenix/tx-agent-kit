import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('log', () => {
  const originalDev = (globalThis as Record<string, unknown>).__DEV__

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    ;(globalThis as Record<string, unknown>).__DEV__ = originalDev
    vi.restoreAllMocks()
  })

  it('calls console methods when __DEV__ is true', async () => {
    ;(globalThis as Record<string, unknown>).__DEV__ = true

    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spyDebug = vi.spyOn(console, 'debug').mockImplementation(() => {})

    const { log } = await import('./log')

    log.info('hello')
    log.warn('warning')
    log.error('error')
    log.debug('debug')

    expect(spyLog).toHaveBeenCalledWith('[INFO]', 'hello')
    expect(spyWarn).toHaveBeenCalledWith('[WARN]', 'warning')
    expect(spyError).toHaveBeenCalledWith('[ERROR]', 'error')
    expect(spyDebug).toHaveBeenCalledWith('[DEBUG]', 'debug')
  })

  it('suppresses info/warn/debug but keeps error when __DEV__ is false', async () => {
    ;(globalThis as Record<string, unknown>).__DEV__ = false

    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spyDebug = vi.spyOn(console, 'debug').mockImplementation(() => {})

    const { log } = await import('./log')

    log.info('hello')
    log.warn('warning')
    log.error('error')
    log.debug('debug')

    expect(spyLog).not.toHaveBeenCalled()
    expect(spyWarn).not.toHaveBeenCalled()
    expect(spyError).toHaveBeenCalledWith('[ERROR]', 'error')
    expect(spyDebug).not.toHaveBeenCalled()
  })

  it('passes multiple arguments through', async () => {
    ;(globalThis as Record<string, unknown>).__DEV__ = true
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { log } = await import('./log')
    log.info('msg', { detail: 1 }, 42)

    expect(spyLog).toHaveBeenCalledWith('[INFO]', 'msg', { detail: 1 }, 42)
  })
})
