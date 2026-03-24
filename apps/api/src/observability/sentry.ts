import type { ApiEnv } from '../config/env.js'

const spotlightPlaceholderDsn = 'https://spotlight@local/0'

interface SentryNodeModule {
  init: (options: {
    dsn: string
    environment: string
    tracesSampleRate: number
    spotlight?: boolean
  }) => void
  captureException: (error: unknown) => unknown
  flush: (timeout?: number) => PromiseLike<unknown>
}

let isInitialized = false
let initializationPromise: Promise<boolean> | null = null
let sentryModule: SentryNodeModule | null = null

const resolveSentryModule = async (): Promise<SentryNodeModule> => {
  if (sentryModule) {
    return sentryModule
  }

  sentryModule = await import('@sentry/node')
  return sentryModule
}

const parseBooleanString = (value: string | undefined): boolean => {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1'
}

export const initializeApiSentry = async (env: ApiEnv): Promise<boolean> => {
  if (isInitialized) {
    return false
  }

  if (initializationPromise) {
    return initializationPromise
  }

  const spotlightEnabled = parseBooleanString(env.SENTRY_SPOTLIGHT)
  const dsn = env.API_SENTRY_DSN ?? (spotlightEnabled ? spotlightPlaceholderDsn : undefined)

  if (!dsn) {
    return false
  }

  initializationPromise = (async () => {
    const Sentry = await resolveSentryModule()
    Sentry.init({
      dsn,
      environment: env.NODE_ENV,
      tracesSampleRate: spotlightEnabled ? 1.0 : 0,
      spotlight: spotlightEnabled
    })

    isInitialized = true
    return true
  })()

  const currentInitialization = initializationPromise

  return (async () => {
    try {
      return await currentInitialization
    } catch {
      isInitialized = false
      sentryModule = null
      return false
    } finally {
      if (initializationPromise === currentInitialization) {
        initializationPromise = null
      }
    }
  })()
}

export const captureApiException = (error: unknown): void => {
  if (!isInitialized || !sentryModule) {
    return
  }

  sentryModule.captureException(error)
}

export const flushApiSentry = async (): Promise<void> => {
  if (!isInitialized || !sentryModule) {
    return
  }

  await sentryModule.flush(2000)
}

export const _resetApiSentryForTest = (): void => {
  isInitialized = false
  initializationPromise = null
  sentryModule = null
}
