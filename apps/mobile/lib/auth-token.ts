import * as SecureStore from 'expo-secure-store'

const AUTH_TOKEN_STORAGE_KEY = 'tx-agent-kit.auth-token'

export const readAuthToken = async (): Promise<string | null> => {
  return SecureStore.getItemAsync(AUTH_TOKEN_STORAGE_KEY)
}

export const writeAuthToken = async (token: string): Promise<void> => {
  await SecureStore.setItemAsync(AUTH_TOKEN_STORAGE_KEY, token)
}

export const clearAuthToken = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_STORAGE_KEY)
}
