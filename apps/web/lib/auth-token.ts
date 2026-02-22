const AUTH_TOKEN_STORAGE_KEY = 'tx-agent-kit.auth-token'

const isBrowser = (): boolean => typeof window !== 'undefined'

export const readAuthToken = (): string | null => {
  if (!isBrowser()) {
    return null
  }

  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
}

export const writeAuthToken = (token: string): void => {
  if (!isBrowser()) {
    return
  }

  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
}

export const clearAuthToken = (): void => {
  if (!isBrowser()) {
    return
  }

  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
}
