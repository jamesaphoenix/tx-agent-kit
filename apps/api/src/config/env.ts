import * as Schema from 'effect/Schema'

const requiredApiEnvShape = {
  NODE_ENV: Schema.String,
  API_PORT: Schema.String,
  API_HOST: Schema.String,
  DATABASE_URL: Schema.String,
  AUTH_SECRET: Schema.String,
  API_CORS_ORIGIN: Schema.String
} as const

export const requiredApiEnvKeys = [
  'NODE_ENV',
  'API_PORT',
  'API_HOST',
  'DATABASE_URL',
  'AUTH_SECRET',
  'API_CORS_ORIGIN'
] as const

export const ApiEnvSchema = Schema.Struct(requiredApiEnvShape)
export type ApiEnv = Schema.Schema.Type<typeof ApiEnvSchema>

export const decodeApiEnv = Schema.decodeUnknownSync(ApiEnvSchema)

const assertApiEnvInvariants = (env: ApiEnv): ApiEnv => {
  if (env.NODE_ENV === 'production' && env.AUTH_SECRET === 'change-me-in-production') {
    throw new Error('AUTH_SECRET cannot use the default placeholder in production.')
  }

  return env
}

export const getApiEnv = (): ApiEnv =>
  assertApiEnvInvariants(decodeApiEnv(process.env))
