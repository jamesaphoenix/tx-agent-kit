import { getApiEnv } from '../config/env.js'

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]

export const getCorsConfig = () => {
  const apiEnv = getApiEnv()
  const originEnv = apiEnv.API_CORS_ORIGIN

  let allowedOrigins: ReadonlyArray<string>
  if (!originEnv) {
    allowedOrigins = DEFAULT_CORS_ORIGINS
  } else if (originEnv === '*') {
    allowedOrigins = ['*']
  } else {
    allowedOrigins = originEnv.split(',').map((origin) => origin.trim())
  }

  return {
    allowedOrigins,
    allowedMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] as const,
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: originEnv !== '*',
    maxAge: 3600
  }
}
