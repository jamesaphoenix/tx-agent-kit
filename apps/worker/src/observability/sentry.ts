import type { WorkerEnv } from '../config/env.js'

interface SentryNodeModule {
  init: (options: { dsn: string; environment: string; tracesSampleRate: number }) => void
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

export const initializeWorkerSentry = async (env: WorkerEnv): Promise<boolean> => {
  if (isInitialized) {
    return false
  }

  if (initializationPromise) {
    return initializationPromise
  }

  if (!env.WORKER_SENTRY_DSN) {
    return false
  }
  const sentryDsn = env.WORKER_SENTRY_DSN

  initializationPromise = (async () => {
    const Sentry = await resolveSentryModule()
    Sentry.init({
      dsn: sentryDsn,
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
      sentryModule = null
      return false
    } finally {
      if (initializationPromise === currentInitialization) {
        initializationPromise = null
      }
    }
  })()
}

export const captureWorkerException = (error: unknown): void => {
  if (!isInitialized || !sentryModule) {
    return
  }

  sentryModule.captureException(error)
}

export const flushWorkerSentry = async (): Promise<void> => {
  if (!isInitialized || !sentryModule) {
    return
  }

  await sentryModule.flush(2_000)
}

export const _resetWorkerSentryForTest = (): void => {
  isInitialized = false
  initializationPromise = null
  sentryModule = null
}
