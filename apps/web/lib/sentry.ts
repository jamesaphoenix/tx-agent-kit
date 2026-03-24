import { getWebEnv } from './env'

const spotlightPlaceholderDsn = 'https://spotlight@local/0'

let isInitialized = false
let initializationPromise: Promise<boolean> | null = null

export const initializeWebSentry = (): Promise<boolean> => {
  if (isInitialized) {
    return Promise.resolve(false)
  }

  if (initializationPromise) {
    return initializationPromise
  }

  const env = getWebEnv()
  const spotlightEnabled = env.SENTRY_SPOTLIGHT
  const dsn = env.SENTRY_DSN ?? (spotlightEnabled ? spotlightPlaceholderDsn : undefined)

  if (!dsn) {
    return Promise.resolve(false)
  }

  initializationPromise = (async () => {
    const Sentry = await import('@sentry/browser')
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
      return false
    } finally {
      if (initializationPromise === currentInitialization) {
        initializationPromise = null
      }
    }
  })()
}

export const _resetWebSentryForTest = (): void => {
  isInitialized = false
  initializationPromise = null
}
