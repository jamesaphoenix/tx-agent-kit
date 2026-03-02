import { getApiEnv } from '../config/env.js'

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]

export const getCorsConfig = () => {
  const apiEnv = getApiEnv()
  const originEnv = apiEnv.API_CORS_ORIGIN

  const isWildcard = originEnv === '*'
  const allowedOrigins = originEnv
    ? isWildcard
      ? ['*' as const]
      : originEnv.split(',').map((origin) => origin.trim())
    : DEFAULT_CORS_ORIGINS

  return {
    allowedOrigins,
    allowedMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] as const,
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: !isWildcard,
    maxAge: 3600
  }
}
