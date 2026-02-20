const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]

export const getCorsConfig = () => {
  const originEnv = process.env.API_CORS_ORIGIN

  return {
    allowedOrigins: originEnv
      ? originEnv === '*'
        ? ['*' as const]
        : originEnv.split(',').map((origin) => origin.trim())
      : DEFAULT_CORS_ORIGINS,
    allowedMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] as const,
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 3600
  }
}
