export interface AuthEnv {
  AUTH_SECRET: string
}

export const getAuthEnv = (): AuthEnv => {
  return {
    AUTH_SECRET: process.env.AUTH_SECRET ?? ''
  }
}
