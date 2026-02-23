export interface AuthEnv {
  AUTH_SECRET: string
  AUTH_BCRYPT_ROUNDS: number
}

const defaultBcryptRounds = 12
const minBcryptRounds = 4
const maxBcryptRounds = 15

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
  return {
    AUTH_SECRET: process.env.AUTH_SECRET ?? '',
    AUTH_BCRYPT_ROUNDS: parseBcryptRounds(process.env.AUTH_BCRYPT_ROUNDS)
  }
}
