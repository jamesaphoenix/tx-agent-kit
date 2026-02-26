import * as SecureStore from 'expo-secure-store'

const AUTH_TOKEN_STORAGE_KEY = 'tx-agent-kit.auth-token'
const REFRESH_TOKEN_STORAGE_KEY = 'tx-agent-kit.refresh-token'

export const readAuthToken = async (): Promise<string | null> => {
  return SecureStore.getItemAsync(AUTH_TOKEN_STORAGE_KEY)
}

export const writeAuthToken = async (token: string): Promise<void> => {
  await SecureStore.setItemAsync(AUTH_TOKEN_STORAGE_KEY, token)
}

export const clearAuthToken = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_STORAGE_KEY)
}

export const readRefreshToken = async (): Promise<string | null> => {
  return SecureStore.getItemAsync(REFRESH_TOKEN_STORAGE_KEY)
}

export const writeRefreshToken = async (token: string): Promise<void> => {
  await SecureStore.setItemAsync(REFRESH_TOKEN_STORAGE_KEY, token)
}

export const clearRefreshToken = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY)
}
