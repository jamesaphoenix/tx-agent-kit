import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sentryInitMock } = vi.hoisted(() => ({
  sentryInitMock: vi.fn()
}))

const mutableProcessEnv = process.env as Record<string, string | undefined>

vi.mock('@sentry/browser', () => ({
  init: sentryInitMock
}))

describe('initializeWebSentry', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete mutableProcessEnv.NEXT_PUBLIC_SENTRY_DSN
    delete mutableProcessEnv.NEXT_PUBLIC_NODE_ENV
    delete mutableProcessEnv.NEXT_PUBLIC_SENTRY_SPOTLIGHT
    delete mutableProcessEnv.SENTRY_SPOTLIGHT
    delete mutableProcessEnv.NODE_ENV
  })

  it('skips initialization when DSN is not configured', async () => {
    const { initializeWebSentry } = await import('./sentry')

    await expect(initializeWebSentry()).resolves.toBe(false)
    expect(sentryInitMock).not.toHaveBeenCalled()
  })

  it('initializes once when DSN is configured', async () => {
    mutableProcessEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://public@sentry.example.com/1'
    mutableProcessEnv.NEXT_PUBLIC_NODE_ENV = 'staging'

    const { initializeWebSentry } = await import('./sentry')

    await expect(initializeWebSentry()).resolves.toBe(true)
    await expect(initializeWebSentry()).resolves.toBe(false)
    expect(sentryInitMock).toHaveBeenCalledTimes(1)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@sentry.example.com/1',
        environment: 'staging',
        tracesSampleRate: 0,
        spotlight: false
      })
    )
  })

  it('initializes with spotlight when SENTRY_SPOTLIGHT is true and no DSN', async () => {
    mutableProcessEnv.SENTRY_SPOTLIGHT = 'true'

    const { initializeWebSentry } = await import('./sentry')

    await expect(initializeWebSentry()).resolves.toBe(true)
    expect(sentryInitMock).toHaveBeenCalledTimes(1)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://spotlight@local/0',
        tracesSampleRate: 1.0,
        spotlight: true
      })
    )
  })

  it('initializes with spotlight and real DSN when both are configured', async () => {
    mutableProcessEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://public@sentry.example.com/1'
    mutableProcessEnv.SENTRY_SPOTLIGHT = 'true'

    const { initializeWebSentry } = await import('./sentry')

    await expect(initializeWebSentry()).resolves.toBe(true)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@sentry.example.com/1',
        tracesSampleRate: 1.0,
        spotlight: true
      })
    )
  })

  it('prefers NEXT_PUBLIC_SENTRY_SPOTLIGHT over SENTRY_SPOTLIGHT', async () => {
    mutableProcessEnv.NEXT_PUBLIC_SENTRY_SPOTLIGHT = 'true'
    mutableProcessEnv.SENTRY_SPOTLIGHT = 'false'

    const { initializeWebSentry } = await import('./sentry')

    await expect(initializeWebSentry()).resolves.toBe(true)
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spotlight: true
      })
    )
  })

  it('skips initialization when spotlight is false and no DSN', async () => {
    mutableProcessEnv.SENTRY_SPOTLIGHT = 'false'

    const { initializeWebSentry } = await import('./sentry')

    await expect(initializeWebSentry()).resolves.toBe(false)
    expect(sentryInitMock).not.toHaveBeenCalled()
  })
})
