const defaultApiBaseUrl = 'http://localhost:4000'

export interface WebEnv {
  API_BASE_URL: string
}

let cachedEnv: WebEnv | null = null

export const getWebEnv = (): WebEnv => {
  if (cachedEnv) {
    return cachedEnv
  }

  cachedEnv = {
    API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      process.env.API_BASE_URL ??
      defaultApiBaseUrl
  }

  return cachedEnv
}
