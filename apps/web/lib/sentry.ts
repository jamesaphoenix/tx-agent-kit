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

/**
 * Explicitly report an error to Sentry. Needed by error boundaries:
 * React swallows render errors it catches, so `window.onerror` never fires
 * and the SDK's global handlers never see them.
 *
 * Returns true when the error was handed to Sentry, false when reporting is
 * unavailable (no DSN) or fails. Never throws.
 */
export const reportWebError = async (error: unknown): Promise<boolean> => {
  try {
    await initializeWebSentry()
    if (!isInitialized) {
      return false
    }
    const Sentry = await import('@sentry/browser')
    Sentry.captureException(error)
    return true
  } catch {
    return false
  }
}

export const _resetWebSentryForTest = (): void => {
  isInitialized = false
  initializationPromise = null
}
