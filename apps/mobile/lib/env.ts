import Constants from 'expo-constants'

const defaultApiBaseUrl = 'http://localhost:4000'

export interface MobileEnv {
  API_BASE_URL: string
}

let cachedEnv: MobileEnv | null = null

export const getMobileEnv = (): MobileEnv => {
  if (cachedEnv) {
    return cachedEnv
  }

  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined

  cachedEnv = {
    API_BASE_URL: (typeof extra?.API_BASE_URL === 'string' ? extra.API_BASE_URL : null) ?? defaultApiBaseUrl
  }

  return cachedEnv
}

export const _resetEnvCacheForTest = (): void => {
  cachedEnv = null
}
