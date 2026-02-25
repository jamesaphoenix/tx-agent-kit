import { getMobileEnv } from './env'

let isInitialized = false
let initializationPromise: Promise<boolean> | null = null

export const initializeMobileSentry = (): Promise<boolean> => {
  if (isInitialized) {
    return Promise.resolve(false)
  }

  if (initializationPromise) {
    return initializationPromise
  }

  const env = getMobileEnv()
  if (!env.SENTRY_DSN) {
    return Promise.resolve(false)
  }

  initializationPromise = (async () => {
    const Sentry = await import('@sentry/react-native')
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: 0
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

export const _resetMobileSentryForTest = (): void => {
  isInitialized = false
  initializationPromise = null
}
