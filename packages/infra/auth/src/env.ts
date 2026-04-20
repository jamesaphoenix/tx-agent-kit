export interface AuthEnv {
  AUTH_SECRET: string
  AUTH_BCRYPT_ROUNDS: number
  AUTH_ACCESS_TOKEN_TTL: string
}

const defaultBcryptRounds = 12
const minBcryptRounds = 4
const maxBcryptRounds = 15
const defaultAccessTokenTtl = '15m'

const parseBcryptRounds = (rawValue: string | undefined): number => {
  if (!rawValue) {
    return defaultBcryptRounds
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsed) || parsed < minBcryptRounds || parsed > maxBcryptRounds) {
    return defaultBcryptRounds
  }

  return parsed
}

export const getAuthEnv = (): AuthEnv => {
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) {
    throw new Error('AUTH_SECRET environment variable is required')
  }

  return {
    AUTH_SECRET: authSecret,
    AUTH_BCRYPT_ROUNDS: parseBcryptRounds(process.env.AUTH_BCRYPT_ROUNDS),
    AUTH_ACCESS_TOKEN_TTL: process.env.AUTH_ACCESS_TOKEN_TTL?.trim() ?? defaultAccessTokenTtl
  }
}
