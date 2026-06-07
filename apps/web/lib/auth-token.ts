let authToken: string | null = null
let authSessionVersion = 0

const authRefreshLockStorageKey = 'tx-agent-kit.auth-refresh-lock'
const authRefreshLockTtlMs = 10_000
const authRefreshLockPollIntervalMs = 100
let serializedAuthRefreshPromise: Promise<unknown> | null = null
const authRefreshLockOwnerId =
  typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `refresh-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`

interface AuthRefreshLockRecord {
  readonly ownerId: string
  readonly expiresAtMs: number
}

const getWindowStorage = (): Storage | null => {
  if (typeof globalThis.window === 'undefined') {
    return null
  }

  try {
    return globalThis.window.localStorage
  } catch {
    return null
  }
}

const readRefreshLockRecord = (): AuthRefreshLockRecord | null => {
  const storage = getWindowStorage()
  if (storage === null) {
    return null
  }

  const rawValue = storage.getItem(authRefreshLockStorageKey)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AuthRefreshLockRecord>
    if (
      typeof parsed.ownerId !== 'string' ||
      parsed.ownerId.length === 0 ||
      typeof parsed.expiresAtMs !== 'number' ||
      !Number.isFinite(parsed.expiresAtMs)
    ) {
      storage.removeItem(authRefreshLockStorageKey)
      return null
    }

    return {
      ownerId: parsed.ownerId,
      expiresAtMs: parsed.expiresAtMs
    }
  } catch {
    storage.removeItem(authRefreshLockStorageKey)
    return null
  }
}

const hasActiveRefreshLock = (): boolean => {
  const lockRecord = readRefreshLockRecord()
  if (!lockRecord) {
    return false
  }

  if (lockRecord.expiresAtMs <= Date.now()) {
    const storage = getWindowStorage()
    if (storage !== null) {
      storage.removeItem(authRefreshLockStorageKey)
    }
    return false
  }

  return true
}

const tryAcquireRefreshLock = (): boolean => {
  const storage = getWindowStorage()
  if (storage === null) {
    return true
  }

  if (hasActiveRefreshLock()) {
    const existingLock = readRefreshLockRecord()
    return existingLock?.ownerId === authRefreshLockOwnerId
  }

  const nextLockRecord: AuthRefreshLockRecord = {
    ownerId: authRefreshLockOwnerId,
    expiresAtMs: Date.now() + authRefreshLockTtlMs
  }
  storage.setItem(authRefreshLockStorageKey, JSON.stringify(nextLockRecord))

  return readRefreshLockRecord()?.ownerId === authRefreshLockOwnerId
}

const releaseRefreshLock = (): void => {
  const storage = getWindowStorage()
  if (storage === null) {
    return
  }

  const lockRecord = readRefreshLockRecord()
  if (lockRecord?.ownerId === authRefreshLockOwnerId) {
    storage.removeItem(authRefreshLockStorageKey)
  }
}

const waitForRefreshLockRelease = async (): Promise<void> => {
  if (typeof globalThis.window === 'undefined' || !hasActiveRefreshLock()) {
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false

    const cleanup = (): void => {
      if (settled) {
        return
      }

      settled = true
      globalThis.window.removeEventListener('storage', onStorage)
      globalThis.window.clearInterval(pollTimer)
      globalThis.window.clearTimeout(timeoutTimer)
      resolve()
    }

    const onStorage = (event: StorageEvent): void => {
      if (event.key !== authRefreshLockStorageKey) {
        return
      }

      if (!hasActiveRefreshLock()) {
        cleanup()
      }
    }

    const pollTimer = globalThis.window.setInterval(() => {
      if (!hasActiveRefreshLock()) {
        cleanup()
      }
    }, authRefreshLockPollIntervalMs)

    const timeoutTimer = globalThis.window.setTimeout(cleanup, authRefreshLockTtlMs + 250)

    globalThis.window.addEventListener('storage', onStorage)
  })
}

export const withSerializedAuthRefresh = async <T>(
  callback: () => Promise<T>
): Promise<T> => {
  if (serializedAuthRefreshPromise !== null) {
    const sharedResult = await serializedAuthRefreshPromise
    return sharedResult as T
  }

  const refreshPromise = (async () => {
    for (;;) {
      if (tryAcquireRefreshLock()) {
        try {
          return await callback()
        } finally {
          releaseRefreshLock()
        }
      }

      await waitForRefreshLockRelease()
    }
  })()

  serializedAuthRefreshPromise = refreshPromise

  try {
    return await refreshPromise
  } finally {
    if (serializedAuthRefreshPromise === refreshPromise) {
      serializedAuthRefreshPromise = null
    }
  }
}

export const readAuthToken = (): string | null => authToken

/**
 * Monotonic session version. Each fresh login or sign-out bumps it. Callers can
 * snapshot the version before an async refresh and only act on a stale 401/403
 * if the version still matches, so a slow failing refresh cannot stomp a session
 * that a concurrent fresh login has already established.
 */
export const readAuthSessionVersion = (): number => authSessionVersion

export const isAuthSessionVersionCurrent = (version: number): boolean =>
  authSessionVersion === version

export const writeAuthToken = (token: string): void => {
  authToken = token
}

/**
 * Persist a token for a brand-new session: bump the version and drop any
 * in-flight refresh lock so a previous session's pending refresh cannot clobber
 * this one.
 */
export const writeNewAuthSessionToken = (token: string): void => {
  authSessionVersion += 1
  serializedAuthRefreshPromise = null
  releaseRefreshLock()
  authToken = token
}

export const clearAuthToken = (): void => {
  authSessionVersion += 1
  serializedAuthRefreshPromise = null
  releaseRefreshLock()
  authToken = null
}
