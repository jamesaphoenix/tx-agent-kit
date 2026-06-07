'use client'

import { clientApi } from './client-api'
import { navigateToExternalUrl, sanitizeInternalPath } from './url-state'

/**
 * Where the post-login destination is parked while the browser is away at
 * Google. Google round-trips its own opaque `state`, so we cannot smuggle our
 * `next` path through it; we persist it locally instead and read it back on the
 * callback page (same tab, same origin, so it survives the redirect chain).
 */
export const googleAuthNextPathStorageKey = 'tx-agent-kit.google-auth.next-path'

const getLocalStorage = (): Storage | null => {
  if (typeof globalThis.window === 'undefined') {
    return null
  }

  try {
    return globalThis.window.localStorage
  } catch {
    return null
  }
}

export const storeGoogleAuthNextPath = (nextPath: string): void => {
  const storage = getLocalStorage()
  if (storage === null) {
    return
  }

  try {
    storage.setItem(googleAuthNextPathStorageKey, nextPath)
  } catch {
    // Ignore disabled or unavailable browser storage; sign-in still proceeds.
  }
}

/**
 * Read and clear the parked next path. The value is sanitized to an internal
 * path so a tampered storage entry can never turn the callback into an open
 * redirect. Clearing on read prevents a stale entry replaying on a later login.
 */
export const consumeGoogleAuthNextPath = (fallback: string): string => {
  const storage = getLocalStorage()
  if (storage === null) {
    return sanitizeInternalPath(null, fallback)
  }

  let stored: string | null = null
  try {
    stored = storage.getItem(googleAuthNextPathStorageKey)
    storage.removeItem(googleAuthNextPathStorageKey)
  } catch {
    stored = null
  }

  return sanitizeInternalPath(stored, fallback)
}

/**
 * Kick off the Google OIDC login: park the destination, ask the API for the
 * provider authorization URL, then hand the tab over to Google. Throws if the
 * start call fails so the caller can surface the error and stay on the page.
 */
export const beginGoogleAuth = async (nextPath: string): Promise<void> => {
  storeGoogleAuthNextPath(nextPath)
  const { authorizationUrl } = await clientApi.googleStart()
  navigateToExternalUrl(authorizationUrl)
}
